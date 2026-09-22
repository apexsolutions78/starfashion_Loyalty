import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { ClaimService } from './ClaimService';
import { PointsEngineService } from './PointsEngineService';
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
  receiptImagePath: string;
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

export class ReviewService {
  static async getPendingClaims(options: {
    limit?: number;
    offset?: number;
    search?: string;
  } = {}): Promise<{ claims: ClaimWithCustomer[]; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .join('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .where('receipt_claims.status', 'PENDING_REVIEW')
      .select(
        'receipt_claims.*',
        'users.email as customerEmail',
        'customer_profiles.full_name as customerName',
        'users.mobile as customerMobile',
      );

    let countQuery = db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .where('receipt_claims.status', 'PENDING_REVIEW');

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

    return { claims: claims as ClaimWithCustomer[], total };
  }

  static async getClaimDetails(claimId: string): Promise<ClaimWithCustomer> {
    const claim = await db('receipt_claims')
      .join('users', 'receipt_claims.customer_id', 'users.id')
      .join('customer_profiles', 'users.id', 'customer_profiles.user_id')
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

    return claim as ClaimWithCustomer;
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

    await db.transaction(async (trx) => {
      await trx('receipt_claims')
        .where('id', claimId)
        .update({
          status: 'APPROVED',
          approved_amount: decision.approvedAmount,
          eligible_amount: decision.eligibleAmount,
          reviewer_notes: decision.reviewerNotes,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      await trx('audit_logs').insert({
        user_id: reviewerId,
        action: 'CLAIM_APPROVED',
        entity_type: 'receipt_claim',
        entity_id: claimId,
        new_values: JSON.stringify({
          approvedAmount: decision.approvedAmount,
          eligibleAmount: decision.eligibleAmount,
          reviewerNotes: decision.reviewerNotes,
        }),
      });

      const pointsCalc = await PointsEngineService.calculatePoints(decision.eligibleAmount);

      if (pointsCalc.totalPoints > 0) {
        await PointsEngineService.creditPoints(
          claim.customer_id,
          claimId,
          pointsCalc.totalPoints,
          pointsCalc.ruleSnapshot,
          pointsCalc.appliedOffers,
          reviewerId,
          requestId,
        );
      }

      await ClaimService.createNotification(
        claim.customer_id,
        'claim_approved',
        'Receipt Approved',
        `Your receipt ${claim.receipt_number} has been approved. ${pointsCalc.totalPoints} points have been credited to your account.`,
        { claimId, approvedAmount: decision.approvedAmount, pointsEarned: pointsCalc.totalPoints },
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
      await trx('receipt_claims')
        .where('id', claimId)
        .update({
          status: 'REJECTED',
          rejection_reason: reason,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      await trx('audit_logs').insert({
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
      await trx('receipt_claims')
        .where('id', claimId)
        .update({
          status: 'REQUEST_CLEARER_IMAGE',
          reviewer_notes: notes,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        });

      await trx('audit_logs').insert({
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
      );

      log.info('Clearer image requested', { claimId, reviewerId });
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
        db.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as pendingClaims', ['PENDING_REVIEW']),
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
