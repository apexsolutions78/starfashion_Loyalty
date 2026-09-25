import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { ClaimService } from './ClaimService';
import { PointsEngineService } from './PointsEngineService';
import { OfferService } from './OfferService';
import { newId } from '../utils/crypto';
import { serializeClaim } from '../utils/serialize';
import fs from 'fs/promises';

interface ReviewDecision {
  approvedAmount: number;
  eligibleAmount: number;
  reviewerNotes?: string;
  rejectionReason?: string;
}

interface ClaimWithCustomer {
  id: string;
  customerId: string;
  receiptNumber: string;
  purchaseDate: string;
  submittedAmount: number;
  submittedArticles: string[] | null;
  imageAvailable: boolean;
  status: string;
  approvedAmount: number | null;
  eligibleAmount: number | null;
  reviewerNotes: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  customerEmail: string;
  customerName: string;
  customerMobile: string;
}

export function parseSubmittedArticles(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).filter((v) => v.trim() !== '');
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(String).filter((v) => v.trim() !== '');
  } catch {
    // fall through to comma-split
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CLAIM_STATUSES = [
  'SUBMITTED',
  'PENDING_REVIEW',
  'REQUEST_CLEARER_IMAGE',
  'APPROVED',
  'REJECTED',
  'REVERSED',
] as const;

export class ReviewService {
  static async getPendingClaims(options: {
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
  } = {}): Promise<{ claims: ClaimWithCustomer[]; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const status =
      options.status && (CLAIM_STATUSES as readonly string[]).includes(options.status)
        ? options.status
        : 'PENDING_REVIEW';

    let query = db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .leftJoin('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .where('receipt_claims.status', status)
      .select(
        'receipt_claims.*',
        'users.email as customerEmail',
        'customer_profiles.full_name as customerName',
        'users.mobile as customerMobile',
      );

    let countQuery = db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .leftJoin('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .where('receipt_claims.status', status);

    if (options.search) {
      const searchTerm = `%${options.search}%`;
      query = query.where(function () {
        this.where('receipt_claims.receipt_number', 'like', searchTerm)
          .orWhere('customer_profiles.full_name', 'like', searchTerm)
          .orWhere('users.email', 'like', searchTerm);
      });
      countQuery = countQuery.where(function () {
        this.where('receipt_claims.receipt_number', 'like', searchTerm)
          .orWhere('customer_profiles.full_name', 'like', searchTerm)
          .orWhere('users.email', 'like', searchTerm);
      });
    }

    const [countResult] = await countQuery.count('* as total');
    const total = Number(countResult?.total || 0);

    const claims = await query
      .orderBy('receipt_claims.created_at', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      claims: claims.map((row) => serializeClaim(row as Record<string, any>)) as unknown as ClaimWithCustomer[],
      total,
    };
  }

  static async getClaimDetails(claimId: string): Promise<ClaimWithCustomer> {
    const claim = await db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .leftJoin('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .where('receipt_claims.id', claimId)
      .select(
        'receipt_claims.*',
        'users.email as customerEmail',
        'customer_profiles.full_name as customerName',
        'users.mobile as customerMobile',
      )
      .first();

    if (!claim) {
      throw createAppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    return serializeClaim(claim as Record<string, any>) as unknown as ClaimWithCustomer;
  }

  static async approveClaim(
    claimId: string,
    reviewerId: string,
    decision: ReviewDecision,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const claim = await db('receipt_claims')
      .where('id', claimId)
      .where('status', 'PENDING_REVIEW')
      .first();

    if (!claim) {
      throw createAppError('Claim not found or not pending review', 404, 'CLAIM_NOT_FOUND');
    }

    if (decision.approvedAmount <= 0) {
      throw createAppError('Approved amount must be positive', 400, 'INVALID_AMOUNT');
    }

    if (decision.eligibleAmount > decision.approvedAmount) {
      throw createAppError('Eligible amount cannot exceed approved amount', 400, 'INVALID_AMOUNT');
    }

    const submittedAmount = Number(claim.submitted_amount || 0);
    if (submittedAmount > 0 && decision.approvedAmount > submittedAmount) {
      throw createAppError('Approved amount cannot exceed submitted amount', 400, 'INVALID_AMOUNT');
    }
    if (submittedAmount > 0 && decision.eligibleAmount > submittedAmount) {
      throw createAppError('Eligible amount cannot exceed submitted amount', 400, 'INVALID_AMOUNT');
    }

    await db.transaction(async (trx) => {
      // Lock the claim row so two concurrent approvals cannot both pass the
      // status guard (MySQL: FOR UPDATE; SQLite: knex omits it, writer lock applies).
      const locked = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'PENDING_REVIEW')
        .forUpdate()
        .first();

      if (!locked) {
        throw createAppError('Claim no longer pending review', 409, 'CLAIM_NOT_PENDING');
      }

      const pointsCalc = await PointsEngineService.calculatePoints(
        decision.eligibleAmount,
        {
          customerId: claim.customer_id,
          articles: parseSubmittedArticles(claim.submitted_articles),
        },
        trx,
      );

      const updated = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'PENDING_REVIEW')
        .update({
          status: 'APPROVED',
          approved_amount: decision.approvedAmount,
          eligible_amount: decision.eligibleAmount,
          reviewer_notes: decision.reviewerNotes,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
          rule_snapshot: pointsCalc.ruleSnapshot ? JSON.stringify(pointsCalc.ruleSnapshot) : null,
          offer_snapshot:
            pointsCalc.appliedOffers.length > 0 ? JSON.stringify(pointsCalc.appliedOffers) : null,
        });

      if (!updated) {
        throw createAppError('Claim no longer pending review', 409, 'CLAIM_NOT_PENDING');
      }

      await trx('audit_logs').insert({
        id: newId(),
        user_id: reviewerId,
        action: 'CLAIM_APPROVED',
        entity_type: 'receipt_claim',
        entity_id: claimId,
        new_values: JSON.stringify({
          approvedAmount: decision.approvedAmount,
          eligibleAmount: decision.eligibleAmount,
          reviewerNotes: decision.reviewerNotes,
          basePoints: pointsCalc.basePoints,
          offerBonus: pointsCalc.offerBonus,
        }),
      });

      if (pointsCalc.totalPoints > 0) {
        await PointsEngineService.creditPoints(
          claim.customer_id,
          claimId,
          pointsCalc.basePoints,
          pointsCalc.offerBonus,
          pointsCalc.ruleSnapshot,
          pointsCalc.appliedOffers,
          reviewerId,
          requestId,
          trx,
        );
      }

      for (const offer of pointsCalc.appliedOffers) {
        await OfferService.recordOfferUse(offer.id, trx);
      }

      await ClaimService.createNotification(
        claim.customer_id,
        'claim_approved',
        'Receipt Approved',
        `Your receipt ${claim.receipt_number} has been approved. ${pointsCalc.totalPoints} points have been credited to your account.`,
        { claimId, approvedAmount: decision.approvedAmount, pointsEarned: pointsCalc.totalPoints },
        trx,
      );

      log.info('Claim approved', {
        claimId,
        reviewerId,
        approvedAmount: decision.approvedAmount,
        eligibleAmount: decision.eligibleAmount,
        pointsEarned: pointsCalc.totalPoints,
      });
    });
  }

  static async rejectClaim(
    claimId: string,
    reviewerId: string,
    reason: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const claim = await db('receipt_claims')
      .where('id', claimId)
      .where('status', 'PENDING_REVIEW')
      .first();

    if (!claim) {
      throw createAppError('Claim not found or not pending review', 404, 'CLAIM_NOT_FOUND');
    }

    if (!reason || reason.trim().length === 0) {
      throw createAppError('Rejection reason is required', 400, 'REASON_REQUIRED');
    }

    await db.transaction(async (trx) => {
      const updated = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'PENDING_REVIEW')
        .update({
          status: 'REJECTED',
          rejection_reason: reason,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      if (!updated) {
        throw createAppError('Claim no longer pending review', 409, 'CLAIM_NOT_PENDING');
      }

      await trx('audit_logs').insert({
        id: newId(),
        user_id: reviewerId,
        action: 'CLAIM_REJECTED',
        entity_type: 'receipt_claim',
        entity_id: claimId,
        new_values: JSON.stringify({ rejectionReason: reason }),
      });

      await ClaimService.createNotification(
        claim.customer_id,
        'claim_rejected',
        'Receipt Rejected',
        `Your receipt ${claim.receipt_number} was rejected. Reason: ${reason}`,
        { claimId, rejectionReason: reason },
        trx,
      );

      log.info('Claim rejected', { claimId, reviewerId, reason });
    });
  }

  static async requestClearerImage(
    claimId: string,
    reviewerId: string,
    notes: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const claim = await db('receipt_claims')
      .where('id', claimId)
      .where('status', 'PENDING_REVIEW')
      .first();

    if (!claim) {
      throw createAppError('Claim not found or not pending review', 404, 'CLAIM_NOT_FOUND');
    }

    await db.transaction(async (trx) => {
      const updated = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'PENDING_REVIEW')
        .update({
          status: 'REQUEST_CLEARER_IMAGE',
          reviewer_notes: notes,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      if (!updated) {
        throw createAppError('Claim no longer pending review', 409, 'CLAIM_NOT_PENDING');
      }

      await trx('audit_logs').insert({
        id: newId(),
        user_id: reviewerId,
        action: 'CLAIM_REQUEST_IMAGE',
        entity_type: 'receipt_claim',
        entity_id: claimId,
        new_values: JSON.stringify({ reviewerNotes: notes }),
      });

      await ClaimService.createNotification(
        claim.customer_id,
        'claim_image_requested',
        'Clearer Image Required',
        `Please upload a clearer image of receipt ${claim.receipt_number}. Notes: ${notes}`,
        { claimId, notes },
        trx,
      );

      log.info('Clearer image requested', { claimId, reviewerId });
    });
  }

  /**
   * Manager/Master-admin correction path: reverses the earn entries for an
   * APPROVED claim and marks it REVERSED. The claim is never deleted.
   */
  static async reverseClaim(
    claimId: string,
    actorId: string,
    reason: string,
    requestId: string,
  ): Promise<{ entriesReversed: number }> {
    const log = createRequestLogger(requestId);

    if (!reason || reason.trim().length === 0) {
      throw createAppError('Reversal reason is required', 400, 'REASON_REQUIRED');
    }

    const claim = await db('receipt_claims').where('id', claimId).first();

    if (!claim) {
      throw createAppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    if (claim.status === 'REVERSED') {
      throw createAppError('Claim is already reversed', 409, 'ALREADY_REVERSED');
    }

    if (claim.status !== 'APPROVED') {
      throw createAppError('Only approved claims can be reversed', 409, 'CLAIM_NOT_APPROVED');
    }

    return db.transaction(async (trx) => {
      const locked = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'APPROVED')
        .forUpdate()
        .first();

      if (!locked) {
        throw createAppError('Claim is no longer approved', 409, 'CLAIM_NOT_APPROVED');
      }

      const entriesReversed = await PointsEngineService.reversePoints(
        claimId,
        reason.trim(),
        actorId,
        requestId,
        trx,
      );

      const updated = await trx('receipt_claims')
        .where('id', claimId)
        .where('status', 'APPROVED')
        .update({
          status: 'REVERSED',
          reviewer_notes: reason.trim(),
          reviewed_by: actorId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      if (!updated) {
        throw createAppError('Claim is no longer approved', 409, 'CLAIM_NOT_APPROVED');
      }

      await trx('audit_logs').insert({
        id: newId(),
        user_id: actorId,
        action: 'CLAIM_REVERSED',
        entity_type: 'receipt_claim',
        entity_id: claimId,
        old_values: JSON.stringify({ status: 'APPROVED' }),
        new_values: JSON.stringify({ status: 'REVERSED', reason: reason.trim(), entriesReversed }),
      });

      await ClaimService.createNotification(
        claim.customer_id,
        'claim_reversed',
        'Claim Reversed',
        `Receipt ${claim.receipt_number} was reversed. Reason: ${reason.trim()}`,
        { claimId, reason: reason.trim() },
        trx,
      );

      log.info('Claim reversed', { claimId, actorId, entriesReversed });
      return { entriesReversed };
    });
  }

  static async getImagePath(claimId: string): Promise<string> {
    const claim = await db('receipt_claims')
      .where('id', claimId)
      .select('receipt_image_path')
      .first();

    if (!claim) {
      throw createAppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    const imagePath = claim.receipt_image_path;

    try {
      await fs.access(imagePath);
    } catch {
      throw createAppError('Image file not found', 404, 'IMAGE_NOT_FOUND');
    }

    return imagePath;
  }

  static async getCustomerHistory(customerId: string): Promise<{
    totalClaims: number;
    approvedClaims: number;
    rejectedClaims: number;
    pendingClaims: number;
    totalApprovedAmount: number;
  }> {
    const stats = await db('receipt_claims')
      .where('customer_id', customerId)
      .select(
        db.raw('COUNT(*) as totalClaims'),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as approvedClaims', ['APPROVED']),
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as rejectedClaims', ['REJECTED']),
        db.raw(
          'SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) as pendingClaims',
          ['PENDING_REVIEW', 'REQUEST_CLEARER_IMAGE'],
        ),
        db.raw('SUM(CASE WHEN status = ? THEN approved_amount ELSE 0 END) as totalApprovedAmount', ['APPROVED']),
      )
      .first();

    return {
      totalClaims: Number(stats?.totalClaims || 0),
      approvedClaims: Number(stats?.approvedClaims || 0),
      rejectedClaims: Number(stats?.rejectedClaims || 0),
      pendingClaims: Number(stats?.pendingClaims || 0),
      totalApprovedAmount: Number(stats?.totalApprovedAmount || 0),
    };
  }
}
