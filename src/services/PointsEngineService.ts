import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';

interface PointsRule {
  id: string;
  version: number;
  name: string;
  rules: {
    currencyThreshold: number;
    pointsPerThreshold: number;
    minimumPurchaseAmount: number;
    eligibleCategories: string[];
    excludedCategories: string[];
    maxPointsPerClaim: number;
    pointExpiryDays: number | null;
    redemptionConversion: number;
    minimumRedemptionPoints: number;
    maxRedemptionPercentage: number;
    maxFixedDiscount: number;
    earnOnPointsPayment: boolean;
    claimSubmissionWindowDays: number;
  };
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdBy: string;
  createdAt: Date;
}

interface PointsCalculation {
  basePoints: number;
  offerBonus: number;
  totalPoints: number;
  ruleSnapshot: PointsRule;
  appliedOffers: any[];
}

export class PointsEngineService {
  static async getActiveRule(): Promise<PointsRule | null> {
    const now = new Date();
    const rule = await db('loyalty_rules')
      .where('is_active', true)
      .where('effective_from', '<=', now)
      .where(function () {
        this.whereNull('effective_to').orWhere('effective_to', '>', now);
      })
      .orderBy('version', 'desc')
      .first();

    if (!rule) return null;

    return {
      ...rule,
      rules: JSON.parse(rule.rules_json),
    };
  }

  static async calculatePoints(
    eligibleAmount: number,
    ruleId?: string,
  ): Promise<PointsCalculation> {
    let rule: PointsRule | null;

    if (ruleId) {
      const ruleData = await db('loyalty_rules').where('id', ruleId).first();
      if (!ruleData) {
        throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
      }
      rule = { ...ruleData, rules: JSON.parse(ruleData.rules_json) };
    } else {
      rule = await this.getActiveRule();
    }

    if (!rule) {
      return {
        basePoints: 0,
        offerBonus: 0,
        totalPoints: 0,
        ruleSnapshot: null as any,
        appliedOffers: [],
      };
    }

    const { currencyThreshold, pointsPerThreshold, maxPointsPerClaim } = rule.rules;

    const basePoints = Math.floor(eligibleAmount / currencyThreshold) * pointsPerThreshold;
    const cappedPoints = maxPointsPerClaim > 0 ? Math.min(basePoints, maxPointsPerClaim) : basePoints;

    return {
      basePoints: cappedPoints,
      offerBonus: 0,
      totalPoints: cappedPoints,
      ruleSnapshot: rule,
      appliedOffers: [],
    };
  }

  static async creditPoints(
    customerId: string,
    claimId: string,
    points: number,
    ruleSnapshot: PointsRule,
    appliedOffers: any[],
    createdBy: string,
    requestId: string,
  ): Promise<string> {
    const log = createRequestLogger(requestId);

    const idempotencyKey = `claim-${claimId}`;

    const existingEntry = await db('points_ledger')
      .where('idempotency_key', idempotencyKey)
      .first();

    if (existingEntry) {
      log.warn('Points already credited for this claim', { claimId });
      return existingEntry.id;
    }

    const [entry] = await db('points_ledger').insert({
      customer_id: customerId,
      claim_id: claimId,
      type: 'PURCHASE_EARN',
      points: points,
      rule_snapshot: JSON.stringify(ruleSnapshot),
      offer_snapshot: appliedOffers.length > 0 ? JSON.stringify(appliedOffers) : null,
      idempotency_key: idempotencyKey,
      created_by: createdBy,
      reason: `Points earned from receipt claim ${claimId}`,
    }).returning('id');

    log.info('Points credited', { customerId, claimId, points, entryId: entry.id });
    return entry.id;
  }

  static async getBalance(customerId: string): Promise<number> {
    const result = await db('points_ledger')
      .where('customer_id', customerId)
      .sum('points as balance')
      .first();

    return Number(result?.balance || 0);
  }

  static async getLedger(
    customerId: string,
    options: { limit?: number; offset?: number; type?: string } = {},
  ): Promise<{ entries: any[]; total: number; balance: number }> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let query = db('points_ledger').where('customer_id', customerId);
    let countQuery = db('points_ledger').where('customer_id', customerId);

    if (options.type) {
      query = query.where('type', options.type);
      countQuery = countQuery.where('type', options.type);
    }

    const [countResult] = await countQuery.count('* as total');
    const total = Number(countResult?.total || 0);

    const entries = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const balance = await this.getBalance(customerId);

    return { entries, total, balance };
  }

  static async reversePoints(
    claimId: string,
    reason: string,
    reversedBy: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const originalEntry = await db('points_ledger')
      .where('claim_id', claimId)
      .where('type', 'PURCHASE_EARN')
      .first();

    if (!originalEntry) {
      throw createAppError('Original points entry not found', 404, 'ENTRY_NOT_FOUND');
    }

    const reversalEntry = await db('points_ledger')
      .where('claim_id', claimId)
      .where('type', 'CORRECTION_REVERSAL')
      .first();

    if (reversalEntry) {
      throw createAppError('Points already reversed for this claim', 400, 'ALREADY_REVERSED');
    }

    const idempotencyKey = `reversal-${claimId}`;

    await db('points_ledger').insert({
      customer_id: originalEntry.customer_id,
      claim_id: claimId,
      type: 'CORRECTION_REVERSAL',
      points: -originalEntry.points,
      rule_snapshot: originalEntry.rule_snapshot,
      idempotency_key: idempotencyKey,
      created_by: reversedBy,
      reason: reason,
      reversal_reference: originalEntry.id,
    });

    log.info('Points reversed', {
      claimId,
      originalPoints: originalEntry.points,
      reversedBy,
    });
  }
}
