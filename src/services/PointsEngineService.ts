import { db } from '../config/database';
import type { Knex } from 'knex';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { newId } from '../utils/crypto';
import { OfferService } from './OfferService';
import { buildEligibilityContext, isOfferEligible, OfferEligibilityContext } from './OfferEligibilityService';

type Db = Knex | Knex.Transaction;

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

const DAY_MS = 24 * 60 * 60 * 1000;

export class PointsEngineService {
  static async getActiveRule(client: Db = db): Promise<PointsRule | null> {
    const now = new Date();
    const rule = await client('loyalty_rules')
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
    options: { ruleId?: string; customerId?: string; articles?: string[] } = {},
    client: Db = db,
  ): Promise<PointsCalculation> {
    const ruleId = options.ruleId;
    let rule: PointsRule | null;

    if (ruleId) {
      const ruleData = await client('loyalty_rules').where('id', ruleId).first();
      if (!ruleData) {
        throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
      }
      rule = { ...ruleData, rules: JSON.parse(ruleData.rules_json) };
    } else {
      rule = await this.getActiveRule(client);
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

    const rawBase = Math.floor(eligibleAmount / currencyThreshold) * pointsPerThreshold;
    const basePoints = maxPointsPerClaim > 0 ? Math.min(rawBase, maxPointsPerClaim) : rawBase;

    const { offerBonus, appliedOffers } = await this.evaluateOffers(
      eligibleAmount,
      basePoints,
      maxPointsPerClaim,
      options.customerId,
      options.articles ?? [],
      client,
    );

    let totalPoints = basePoints + offerBonus;
    if (maxPointsPerClaim > 0 && totalPoints > maxPointsPerClaim) {
      totalPoints = maxPointsPerClaim;
    }
    const cappedBonus = Math.max(0, totalPoints - basePoints);

    return {
      basePoints,
      offerBonus: cappedBonus,
      totalPoints,
      ruleSnapshot: rule,
      appliedOffers,
    };
  }

  private static async evaluateOffers(
    eligibleAmount: number,
    basePoints: number,
    maxPointsPerClaim: number,
    customerId: string | undefined,
    articles: string[],
    client: Db,
  ): Promise<{ offerBonus: number; appliedOffers: any[] }> {
    if (!customerId || basePoints <= 0) {
      return { offerBonus: 0, appliedOffers: [] };
    }

    const activeOffers = await OfferService.getActiveOffers(client);
    if (activeOffers.length === 0) {
      return { offerBonus: 0, appliedOffers: [] };
    }

    const needsContext = activeOffers.some((offer) => {
      const c = (offer.conditions || {}) as Record<string, unknown>;
      return Boolean(
        (Array.isArray(c.eligibleArticles) && c.eligibleArticles.length > 0) ||
          (Array.isArray(c.eligibleCategories) && c.eligibleCategories.length > 0) ||
          (Array.isArray(c.eligibleTiers) && c.eligibleTiers.length > 0),
      );
    });

    let ctx: OfferEligibilityContext | null = null;
    if (needsContext) {
      ctx = await buildEligibilityContext(customerId, articles, client);
    }

    const chosen: any[] = [];
    for (const offer of activeOffers) {
      if (chosen.some((c) => !c.stackable)) break;
      if (!offer.stackable && chosen.length > 0) break;

      if (ctx && !isOfferEligible(offer, ctx)) continue;

      const conditions = (offer.conditions || {}) as Record<string, unknown>;
      const minPurchase = Number(conditions.minimumPurchaseAmount ?? 0);
      if (minPurchase > 0 && eligibleAmount < minPurchase) continue;

      if (offer.globalMaxUses != null && Number(offer.currentGlobalUses) >= Number(offer.globalMaxUses)) {
        continue;
      }

      try {
        const usage = await OfferService.checkOfferUsage(offer.id, customerId, client);
        if (!usage.canUse) continue;
      } catch {
        continue;
      }

      chosen.push(offer);
      if (!offer.stackable) break;
    }

    if (chosen.length === 0) {
      return { offerBonus: 0, appliedOffers: [] };
    }

    let offerBonus = 0;
    const appliedOffers: any[] = [];

    for (const offer of chosen) {
      const conditions = (offer.conditions || {}) as Record<string, number | undefined>;
      let bonus = 0;

      switch (offer.offerType) {
        case 'multiplier': {
          const mult = Number(conditions.multiplier ?? 0);
          if (mult > 1) {
            bonus = Math.floor(basePoints * (mult - 1));
          }
          break;
        }
        case 'fixed_bonus':
        case 'birthday':
        case 'referral':
        case 'coupon': {
          bonus = Math.max(0, Math.floor(Number(conditions.bonusPoints ?? 0)));
          break;
        }
        case 'percentage_bonus': {
          const pct = Number(conditions.bonusPercentage ?? 0);
          if (pct > 0) {
            bonus = Math.floor((basePoints * pct) / 100);
          }
          break;
        }
        default:
          bonus = 0;
      }

      if (bonus <= 0) continue;

      if (maxPointsPerClaim > 0 && basePoints + offerBonus + bonus > maxPointsPerClaim) {
        bonus = Math.max(0, maxPointsPerClaim - (basePoints + offerBonus));
        if (bonus <= 0) break;
      }

      offerBonus += bonus;
      appliedOffers.push({
        id: offer.id,
        name: offer.name,
        offerType: offer.offerType,
        bonusPoints: bonus,
        priority: offer.priority,
        stackable: offer.stackable,
      });
    }

    return { offerBonus, appliedOffers };
  }

  /**
   * Writes the earn side of an approval as two ledger entries so the base
   * earning and the offer bonus remain separately auditable:
   *   - PURCHASE_EARN  (idempotency `claim-<claimId>`)
   *   - OFFER_BONUS    (idempotency `claim-bonus-<claimId>`), offer_snapshot lives here only
   *   so `OfferService.checkOfferUsage` counts exactly one use per claim.
   */
  /**
   * Absolute moment points credited under a rule stop counting, or null when
   * that rule never expires points. Stamped once at credit time so a later rule
   * edit cannot silently rewrite when existing points die.
   */
  static expiryDateFor(
    pointExpiryDays: number | null | undefined,
    from: Date = new Date(),
  ): Date | null {
    const days = Number(pointExpiryDays ?? 0);
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(from.getTime() + days * DAY_MS);
  }

  static async creditPoints(
    customerId: string,
    claimId: string,
    basePoints: number,
    offerBonus: number,
    ruleSnapshot: PointsRule,
    appliedOffers: any[],
    createdBy: string,
    requestId: string,
    client: Db = db,
  ): Promise<string> {
    const log = createRequestLogger(requestId);

    let primaryEntryId: string | null = null;
    const expiresAt = this.expiryDateFor(ruleSnapshot.rules?.pointExpiryDays);

    if (basePoints > 0) {
      const idempotencyKey = `claim-${claimId}`;
      const existingEntry = await client('points_ledger')
        .where('idempotency_key', idempotencyKey)
        .first();

      if (existingEntry) {
        log.warn('Points already credited for this claim', { claimId });
        primaryEntryId = existingEntry.id;
      } else {
        const entryId = newId();
        await client('points_ledger').insert({
          id: entryId,
          customer_id: customerId,
          claim_id: claimId,
          type: 'PURCHASE_EARN',
          points: basePoints,
          rule_snapshot: JSON.stringify(ruleSnapshot),
          idempotency_key: idempotencyKey,
          created_by: createdBy,
          expires_at: expiresAt,
          reason: `Points earned from receipt claim ${claimId}`,
        });
        primaryEntryId = entryId;
        log.info('Points credited', { customerId, claimId, points: basePoints, entryId });
      }
    }

    if (offerBonus > 0) {
      const idempotencyKey = `claim-bonus-${claimId}`;
      const existingBonus = await client('points_ledger')
        .where('idempotency_key', idempotencyKey)
        .first();

      if (existingBonus) {
        log.warn('Offer bonus already credited for this claim', { claimId });
        primaryEntryId = primaryEntryId ?? existingBonus.id;
      } else {
        const entryId = newId();
        await client('points_ledger').insert({
          id: entryId,
          customer_id: customerId,
          claim_id: claimId,
          type: 'OFFER_BONUS',
          points: offerBonus,
          rule_snapshot: JSON.stringify(ruleSnapshot),
          offer_snapshot: appliedOffers.length > 0 ? JSON.stringify(appliedOffers) : null,
          idempotency_key: idempotencyKey,
          created_by: createdBy,
          expires_at: expiresAt,
          reason: `Offer bonus from receipt claim ${claimId}`,
        });
        primaryEntryId = primaryEntryId ?? entryId;
        log.info('Offer bonus credited', { customerId, claimId, points: offerBonus, entryId });
      }
    }

    if (!primaryEntryId) {
      throw createAppError('No points to credit', 400, 'NO_POINTS_TO_CREDIT');
    }

    return primaryEntryId;
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

  /**
   * Manager-approved manual correction. Never touches an existing row —
   * credits and debits are new append-only entries.
   */
  static async applyManualAdjustment(
    customerId: string,
    points: number,
    reason: string,
    actorId: string,
    requestId: string,
    idempotencyKey?: string,
    client: Db = db,
  ): Promise<string> {
    const log = createRequestLogger(requestId);

    if (!Number.isInteger(points) || points === 0) {
      throw createAppError('Adjustment must be a non-zero whole number of points', 400, 'INVALID_ADJUSTMENT');
    }

    if (!reason || reason.trim().length === 0) {
      throw createAppError('Adjustment reason is required', 400, 'REASON_REQUIRED');
    }

    const customer = await client('users').where('id', customerId).where('role', 'customer').first();
    if (!customer) {
      throw createAppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    if (points < 0) {
      const balanceRow = await client('points_ledger')
        .where('customer_id', customerId)
        .select(client.raw('COALESCE(SUM(points), 0) as balance'))
        .first();
      const balance = Number(balanceRow?.balance || 0);
      if (Math.abs(points) > balance) {
        throw createAppError('Debit exceeds available balance', 400, 'INSUFFICIENT_BALANCE');
      }
    }

    const key = idempotencyKey ?? `adjustment-${newId()}`;
    const existing = await client('points_ledger').where('idempotency_key', key).first();
    if (existing) {
      log.warn('Manual adjustment already applied', { customerId, idempotencyKey: key });
      return existing.id;
    }

    const entryId = newId();
    let expiresAt: Date | null = null;
    if (points > 0) {
      const rule = await this.getActiveRule(client);
      expiresAt = this.expiryDateFor(rule?.rules?.pointExpiryDays);
    }

    await client('points_ledger').insert({
      id: entryId,
      customer_id: customerId,
      type: points > 0 ? 'MANUAL_CREDIT' : 'MANUAL_DEBIT',
      points,
      idempotency_key: key,
      created_by: actorId,
      expires_at: expiresAt,
      reason: reason.trim(),
    });

    await client('audit_logs').insert({
      id: newId(),
      user_id: actorId,
      action: points > 0 ? 'MANUAL_CREDIT' : 'MANUAL_DEBIT',
      entity_type: 'points_ledger',
      entity_id: entryId,
      new_values: JSON.stringify({ customerId, points, reason: reason.trim() }),
    });

    log.info('Manual adjustment applied', { customerId, points, actorId });
    return entryId;
  }

  /**
   * Reverses every earn entry (PURCHASE_EARN and OFFER_BONUS) attached to a
   * claim with a matching CORRECTION_REVERSAL entry per original row.
   * Append-only: nothing is deleted or edited.
   */
  static async reversePoints(
    claimId: string,
    reason: string,
    reversedBy: string,
    requestId: string,
    client: Db = db,
  ): Promise<number> {
    const log = createRequestLogger(requestId);

    const earnEntries = await client('points_ledger')
      .where('claim_id', claimId)
      .whereIn('type', ['PURCHASE_EARN', 'OFFER_BONUS'])
      .orderBy('created_at', 'asc');

    if (earnEntries.length === 0) {
      throw createAppError('Original points entry not found', 404, 'ENTRY_NOT_FOUND');
    }

    const existingReversal = await client('points_ledger')
      .where('claim_id', claimId)
      .where('type', 'CORRECTION_REVERSAL')
      .first();

    if (existingReversal) {
      throw createAppError('Points already reversed for this claim', 400, 'ALREADY_REVERSED');
    }

    let reversed = 0;
    for (const entry of earnEntries) {
      // Expired points are already gone: reversing them again would drive the
      // balance below zero, so only the outstanding remainder is unwound.
      const outstanding = Number(entry.points) - Number(entry.expired_points || 0);
      if (outstanding <= 0) continue;

      const idempotencyKey =
        entry.type === 'OFFER_BONUS' ? `reversal-bonus-${claimId}` : `reversal-${claimId}`;

      const already = await client('points_ledger')
        .where('idempotency_key', idempotencyKey)
        .first();
      if (already) continue;

      await client('points_ledger').insert({
        id: newId(),
        customer_id: entry.customer_id,
        claim_id: claimId,
        type: 'CORRECTION_REVERSAL',
        points: -outstanding,
        rule_snapshot: entry.rule_snapshot,
        offer_snapshot: entry.offer_snapshot,
        idempotency_key: idempotencyKey,
        created_by: reversedBy,
        reason,
        reversal_reference: entry.id,
      });
      reversed += 1;
    }

    log.info('Points reversed', { claimId, entriesReversed: reversed, reversedBy });
    return reversed;
  }

  /**
   * Turns credits whose expires_at has passed into negative `EXPIRY` rows.
   *
   * FIFO and balance-clamped: the oldest credits are consumed first and a run
   * never writes more than the current balance, so points already spent via a
   * redemption or a debit are simply marked consumed instead of being expired
   * a second time - the balance can never be driven negative.
   *
   * Idempotent: the source row is stamped inside the same transaction as the
   * entry it produces, and that entry's idempotency key derives from the source
   * row id.
   */
  static async expireDuePoints(requestId: string): Promise<number> {
    const log = createRequestLogger(requestId);
    const now = new Date();

    const dueCustomers = await db('points_ledger')
      .whereNotNull('expires_at')
      .where('expires_at', '<=', now)
      .whereNull('expired_at')
      .where('points', '>', 0)
      .distinct()
      .select('customer_id');

    let entriesExpired = 0;
    for (const row of dueCustomers) {
      entriesExpired += await this.expireCustomerPoints(String(row.customer_id), now);
    }

    if (entriesExpired > 0) {
      log.info('Points expired', {
        entriesExpired,
        customers: dueCustomers.length,
      });
    }
    return entriesExpired;
  }

  private static async expireCustomerPoints(customerId: string, now: Date): Promise<number> {
    const due = await db('points_ledger')
      .where('customer_id', customerId)
      .whereNotNull('expires_at')
      .where('expires_at', '<=', now)
      .whereNull('expired_at')
      .where('points', '>', 0)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');

    if (due.length === 0) return 0;

    const balanceRow = await db('points_ledger')
      .where('customer_id', customerId)
      .select(db.raw('COALESCE(SUM(points), 0) as balance'))
      .first();

    let available = Math.max(0, Number(balanceRow?.balance || 0));
    let expired = 0;

    for (const row of due) {
      const amount = Math.min(Number(row.points), available);
      available -= amount;

      await db.transaction(async (trx) => {
        if (amount > 0) {
          await trx('points_ledger').insert({
            id: newId(),
            customer_id: customerId,
            claim_id: row.claim_id ?? null,
            type: 'EXPIRY',
            points: -amount,
            rule_snapshot: row.rule_snapshot ?? null,
            offer_snapshot: row.offer_snapshot ?? null,
            idempotency_key: `point-expiry-${row.id}`,
            created_by: row.created_by ?? null,
            reversal_reference: row.id,
            reason: `Points expired on ${now.toISOString().slice(0, 10)}`,
          });
          expired += 1;
        }

        await trx('points_ledger')
          .where('id', row.id)
          .update({ expired_at: now, expired_points: amount });
      });
    }

    return expired;
  }
}
