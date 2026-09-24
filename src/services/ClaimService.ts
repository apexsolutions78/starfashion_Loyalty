import { db } from '../config/database';
import type { Knex } from 'knex';
import { env } from '../config';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { newId } from '../utils/crypto';
import { serializeClaim, serializeNotification } from '../utils/serialize';

type Db = Knex | Knex.Transaction;

interface ClaimInput {
  receiptNumber: string;
  purchaseDate: string;
  submittedAmount: number;
  submittedArticles?: string[];
  receiptImagePath: string;
}

interface Claim {
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
}

export class ClaimService {
  static normalizeReceiptNumber(receiptNumber: string): string {
    return receiptNumber.replace(/\s+/g, '').trim();
  }

  static validateReceiptNumberFormat(receiptNumber: string): boolean {
    const regex = new RegExp(env.RECEIPT_NUMBER_REGEX);
    return regex.test(receiptNumber);
  }

  static async createClaim(
    customerId: string,
    input: ClaimInput,
    requestId: string,
  ): Promise<Claim> {
    const log = createRequestLogger(requestId);

    const normalizedNumber = this.normalizeReceiptNumber(input.receiptNumber);

    if (!this.validateReceiptNumberFormat(normalizedNumber)) {
      throw createAppError(
        'Invalid receipt number format',
        400,
        'INVALID_RECEIPT_FORMAT',
      );
    }

    const existingClaim = await db('receipt_claims')
      .where('receipt_number', normalizedNumber)
      .first();

    if (existingClaim) {
      throw createAppError(
        'This receipt number has already been submitted',
        409,
        'RECEIPT_ALREADY_EXISTS',
      );
    }

    const purchaseDate = new Date(input.purchaseDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (Number.isNaN(purchaseDate.getTime())) {
      throw createAppError('Invalid purchase date', 400, 'INVALID_DATE');
    }

    if (purchaseDate > today) {
      throw createAppError(
        'Purchase date cannot be in the future',
        400,
        'INVALID_DATE',
      );
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (purchaseDate < thirtyDaysAgo) {
      throw createAppError(
        'Receipt must be submitted within 30 days of purchase',
        400,
        'RECEIPT_TOO_OLD',
      );
    }

    // Store as YYYY-MM-DD string — MySQL DATE column rejects Date objects under some drivers,
    // and SQLite would coerce inconsistently.
    const purchaseDateStr = input.purchaseDate.slice(0, 10);

    const claim = await db('receipt_claims').insert({
      id: newId(),
      customer_id: customerId,
      receipt_number: normalizedNumber,
      purchase_date: purchaseDateStr,
      submitted_amount: input.submittedAmount,
      submitted_articles: input.submittedArticles ? JSON.stringify(input.submittedArticles) : null,
      receipt_image_path: input.receiptImagePath,
      status: 'PENDING_REVIEW',
    }).returning('*');

    log.info('Receipt claim created', {
      claimId: claim[0].id,
      customerId,
      receiptNumber: normalizedNumber,
    });

    await this.createNotification(
      customerId,
      'claim_submitted',
      'Receipt Submitted',
      'Your receipt has been submitted for review. This normally takes 24-48 hours.',
      { claimId: claim[0].id },
    );

    return serializeClaim(claim[0] as Record<string, any>) as unknown as Claim;
  }

  static async getCustomerClaims(
    customerId: string,
    options: { limit?: number; offset?: number; status?: string } = {},
  ): Promise<{ claims: Claim[]; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = db('receipt_claims').where('customer_id', customerId);
    let countQuery = db('receipt_claims').where('customer_id', customerId);

    if (options.status) {
      query = query.where('status', options.status);
      countQuery = countQuery.where('status', options.status);
    }

    const [countResult] = await countQuery.count('* as total');
    const total = Number(countResult?.total || 0);

    const claims = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      claims: claims.map((row) => serializeClaim(row as Record<string, any>)) as unknown as Claim[],
      total,
    };
  }

  static async getClaimById(claimId: string, customerId: string): Promise<Claim> {
    const claim = await db('receipt_claims')
      .where('id', claimId)
      .where('customer_id', customerId)
      .first();

    if (!claim) {
      throw createAppError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    return serializeClaim(claim as Record<string, any>) as unknown as Claim;
  }

  static async resubmitClaim(
    claimId: string,
    customerId: string,
    input: { receiptImagePath: string; submittedAmount: number; submittedArticles?: string[] },
    requestId: string,
  ): Promise<Claim> {
    const log = createRequestLogger(requestId);

    const claim = await db('receipt_claims')
      .where('id', claimId)
      .where('customer_id', customerId)
      .where('status', 'REQUEST_CLEARER_IMAGE')
      .first();

    if (!claim) {
      throw createAppError(
        'Claim not found or not eligible for resubmission',
        404,
        'CLAIM_NOT_FOUND',
      );
    }

    const updated = await db('receipt_claims')
      .where('id', claimId)
      .update({
        receipt_image_path: input.receiptImagePath,
        submitted_amount: input.submittedAmount,
        submitted_articles: input.submittedArticles ? JSON.stringify(input.submittedArticles) : claim.submitted_articles,
        status: 'PENDING_REVIEW',
        updated_at: new Date(),
      })
      .returning('*');

    log.info('Claim resubmitted', { claimId, customerId });

    return serializeClaim(updated[0] as Record<string, any>) as unknown as Claim;
  }

  static async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: Record<string, unknown>,
    client: Db = db,
  ): Promise<void> {
    await client('notifications').insert({
      id: newId(),
      user_id: userId,
      type,
      title,
      message,
      data_json: data ? JSON.stringify(data) : null,
    });
  }

  static async getNotifications(
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  ): Promise<{ notifications: any[]; unreadCount: number; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = db('notifications').where('user_id', userId);
    let countQuery = db('notifications').where('user_id', userId);

    if (options.unreadOnly) {
      query = query.where('read', false);
      countQuery = countQuery.where('read', false);
    }

    const [countResult] = await countQuery.count('* as total');
    const total = Number(countResult?.total || 0);

    const notifications = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const [unreadResult] = await db('notifications')
      .where('user_id', userId)
      .where('read', false)
      .count('* as count');

    return {
      notifications: notifications.map((row) => serializeNotification(row as Record<string, any>)),
      unreadCount: Number(unreadResult?.count || 0),
      total,
    };
  }

  static async markNotificationRead(notificationId: string, userId: string): Promise<void> {
    await db('notifications')
      .where('id', notificationId)
      .where('user_id', userId)
      .update({ read: true });
  }

  static async markAllNotificationsRead(userId: string): Promise<void> {
    await db('notifications')
      .where('user_id', userId)
      .where('read', false)
      .update({ read: true });
  }
}
