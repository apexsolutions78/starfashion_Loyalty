import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { PointsEngineService } from './PointsEngineService';
import { randomBytes } from 'crypto';
import { newId } from '../utils/crypto';

interface RedemptionQuote {
  pointsToRedeem: number;
  discountAmount: number;
  conversionRate: number;
  maxRedemptionAmount: number;
  remainingBalance: number;
}

interface Voucher {
  id: string;
  voucherCode: string;
  pointsRedeemed: number;
  discountAmount: number;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export class RedemptionService {
  static async getRedemptionQuote(
    customerId: string,
    pointsToRedeem: number,
  ): Promise<RedemptionQuote> {
    const balance = await PointsEngineService.getBalance(customerId);

    if (pointsToRedeem <= 0) {
      throw createAppError('Points to redeem must be positive', 400, 'INVALID_POINTS');
    }

    if (pointsToRedeem > balance) {
      throw createAppError('Insufficient points balance', 400, 'INSUFFICIENT_BALANCE');
    }

    const rule = await PointsEngineService.getActiveRule();
    if (!rule) {
      throw createAppError('No active loyalty rule found', 400, 'NO_ACTIVE_RULE');
    }

    const { redemptionConversion, minimumRedemptionPoints, maxRedemptionPercentage, maxFixedDiscount } = rule.rules;

    if (pointsToRedeem < minimumRedemptionPoints) {
      throw createAppError(
        `Minimum ${minimumRedemptionPoints} points required for redemption`,
        400,
        'BELOW_MINIMUM',
      );
    }

    const discountAmount = pointsToRedeem * (redemptionConversion / 100);

    let maxRedemptionAmount = discountAmount;
    if (maxRedemptionPercentage > 0) {
      const percentageLimit = maxRedemptionPercentage / 100;
      maxRedemptionAmount = Math.min(maxRedemptionAmount, discountAmount * percentageLimit);
    }
    if (maxFixedDiscount > 0) {
      maxRedemptionAmount = Math.min(maxRedemptionAmount, maxFixedDiscount);
    }

    return {
      pointsToRedeem,
      discountAmount: Math.round(maxRedemptionAmount * 100) / 100,
      conversionRate: redemptionConversion,
      maxRedemptionAmount,
      remainingBalance: balance - pointsToRedeem,
    };
  }

  static async createVoucher(
    customerId: string,
    pointsToRedeem: number,
    requestId: string,
  ): Promise<Voucher> {
    const log = createRequestLogger(requestId);

    const quote = await this.getRedemptionQuote(customerId, pointsToRedeem);

    const voucherCode = this.generateVoucherCode();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const [voucher] = await db.transaction(async (trx) => {
      // Re-check balance inside the transaction to prevent concurrent overspend
      const balanceRow = await trx('points_ledger')
        .where('customer_id', customerId)
        .select(trx.raw('COALESCE(SUM(points), 0) as balance'))
        .first();
      const balance = Number(balanceRow?.balance || 0);
      if (pointsToRedeem > balance) {
        throw createAppError('Insufficient points balance', 400, 'INSUFFICIENT_BALANCE');
      }

      const [v] = await trx('redemption_vouchers').insert({
        id: newId(),
        customer_id: customerId,
        voucher_code: voucherCode,
        points_redeemed: pointsToRedeem,
        discount_amount: quote.discountAmount,
        status: 'ACTIVE',
        expires_at: expiresAt,
      }).returning('*');

      const idempotencyKey = `redemption-${v.id}`;

      const ledgerInserted = await trx('points_ledger').insert({
        id: newId(),
        customer_id: customerId,
        voucher_id: v.id,
        type: 'REDEMPTION',
        points: -pointsToRedeem,
        idempotency_key: idempotencyKey,
        created_by: customerId,
        reason: `Redemption voucher ${voucherCode} created`,
      });

      if (!ledgerInserted) {
        throw createAppError('Failed to record redemption', 500, 'LEDGER_INSERT_FAILED');
      }

      await trx('redemption_vouchers')
        .where('id', v.id)
        .update({ ledger_entry_id: (await trx('points_ledger').where('idempotency_key', idempotencyKey).first())?.id });

      await trx('audit_logs').insert({
        id: newId(),
        user_id: customerId,
        action: 'VOUCHER_CREATED',
        entity_type: 'redemption_voucher',
        entity_id: v.id,
        new_values: JSON.stringify({
          voucherCode,
          pointsRedeemed: pointsToRedeem,
          discountAmount: quote.discountAmount,
        }),
      });

      return [v];
    });

    log.info('Voucher created', {
      voucherId: voucher.id,
      voucherCode,
      customerId,
      pointsRedeemed: pointsToRedeem,
      discountAmount: quote.discountAmount,
    });

    return {
      id: voucher.id,
      voucherCode: voucher.voucher_code,
      pointsRedeemed: voucher.points_redeemed,
      discountAmount: voucher.discount_amount,
      status: voucher.status,
      expiresAt: voucher.expires_at,
      createdAt: voucher.created_at,
    };
  }

  static async useVoucher(
    voucherCode: string,
    usedBy: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const voucher = await db('redemption_vouchers')
      .where('voucher_code', voucherCode)
      .where('status', 'ACTIVE')
      .first();

    if (!voucher) {
      throw createAppError('Invalid or already used voucher', 400, 'INVALID_VOUCHER');
    }

    if (new Date(voucher.expires_at) < new Date()) {
      await db('redemption_vouchers')
        .where('id', voucher.id)
        .update({ status: 'EXPIRED' });
      throw createAppError('Voucher has expired', 400, 'VOUCHER_EXPIRED');
    }

    await db.transaction(async (trx) => {
      const updated = await trx('redemption_vouchers')
        .where('id', voucher.id)
        .where('status', 'ACTIVE')
        .update({
          status: 'USED',
          used_at: new Date(),
          used_by: usedBy,
        });

      if (!updated) {
        throw createAppError('Voucher already used or cancelled', 409, 'VOUCHER_NOT_ACTIVE');
      }

      await trx('audit_logs').insert({
        id: newId(),
        user_id: usedBy,
        action: 'VOUCHER_USED',
        entity_type: 'redemption_voucher',
        entity_id: voucher.id,
        new_values: JSON.stringify({
          voucherCode,
          pointsRedeemed: voucher.points_redeemed,
          discountAmount: voucher.discount_amount,
        }),
      });
    });

    log.info('Voucher used', {
      voucherId: voucher.id,
      voucherCode,
      usedBy,
    });
  }

  static async cancelVoucher(
    voucherId: string,
    customerId: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);

    const voucher = await db('redemption_vouchers')
      .where('id', voucherId)
      .where('customer_id', customerId)
      .where('status', 'ACTIVE')
      .first();

    if (!voucher) {
      throw createAppError('Voucher not found or not active', 404, 'VOUCHER_NOT_FOUND');
    }

    await db.transaction(async (trx) => {
      const updated = await trx('redemption_vouchers')
        .where('id', voucherId)
        .where('status', 'ACTIVE')
        .update({ status: 'CANCELLED' });

      if (!updated) {
        throw createAppError('Voucher no longer active', 409, 'VOUCHER_NOT_ACTIVE');
      }

      const idempotencyKey = `cancellation-${voucherId}`;

      await trx('points_ledger').insert({
        id: newId(),
        customer_id: customerId,
        voucher_id: voucherId,
        type: 'CORRECTION_REVERSAL',
        points: voucher.points_redeemed,
        idempotency_key: idempotencyKey,
        created_by: customerId,
        reason: `Voucher ${voucher.voucher_code} cancelled`,
        reversal_reference: voucher.ledger_entry_id,
      });

      await trx('audit_logs').insert({
        id: newId(),
        user_id: customerId,
        action: 'VOUCHER_CANCELLED',
        entity_type: 'redemption_voucher',
        entity_id: voucherId,
        old_values: JSON.stringify({ status: 'ACTIVE' }),
        new_values: JSON.stringify({ status: 'CANCELLED', pointsRestored: voucher.points_redeemed }),
      });
    });

    log.info('Voucher cancelled', { voucherId, customerId });
  }

  static async getCustomerVouchers(
    customerId: string,
    options: { limit?: number; offset?: number; status?: string } = {},
  ): Promise<{ vouchers: Voucher[]; total: number }> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = db('redemption_vouchers').where('customer_id', customerId);
    let countQuery = db('redemption_vouchers').where('customer_id', customerId);

    if (options.status) {
      query = query.where('status', options.status);
      countQuery = countQuery.where('status', options.status);
    }

    const [countResult] = await countQuery.count('* as total');
    const total = Number(countResult?.total || 0);

    const vouchers = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      vouchers: vouchers.map((v) => ({
        id: v.id,
        voucherCode: v.voucher_code,
        pointsRedeemed: v.points_redeemed,
        discountAmount: v.discount_amount,
        status: v.status,
        expiresAt: v.expires_at,
        createdAt: v.created_at,
      })),
      total,
    };
  }

  static generateVoucherCode(): string {
    const bytes = randomBytes(6);
    const code = bytes.toString('hex').toUpperCase();
    return `SF-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  }

  /**
   * Proactively mark ACTIVE vouchers past expires_at as EXPIRED and restore points.
   * Lazy expiry in useVoucher remains as a race fallback.
   */
  static async expireDueVouchers(requestId: string): Promise<number> {
    const log = createRequestLogger(requestId);
    const now = new Date();

    const count = await db.transaction(async (trx) => {
      const due = await trx('redemption_vouchers')
        .where('status', 'ACTIVE')
        .where('expires_at', '<', now);

      let expired = 0;
      for (const voucher of due) {
        const updated = await trx('redemption_vouchers')
          .where('id', voucher.id)
          .where('status', 'ACTIVE')
          .update({ status: 'EXPIRED' });

        if (!updated) continue;

        const idempotencyKey = `expiry-${voucher.id}`;
        const existing = await trx('points_ledger')
          .where('idempotency_key', idempotencyKey)
          .first();

        if (!existing) {
          await trx('points_ledger').insert({
            id: newId(),
            customer_id: voucher.customer_id,
            voucher_id: voucher.id,
            type: 'EXPIRY',
            points: voucher.points_redeemed,
            idempotency_key: idempotencyKey,
            created_by: voucher.customer_id,
            reason: `Voucher ${voucher.voucher_code} expired`,
            reversal_reference: voucher.ledger_entry_id,
          });
        }

        await trx('audit_logs').insert({
          id: newId(),
          user_id: voucher.customer_id,
          action: 'VOUCHER_EXPIRED',
          entity_type: 'redemption_voucher',
          entity_id: voucher.id,
          old_values: JSON.stringify({ status: 'ACTIVE' }),
          new_values: JSON.stringify({
            status: 'EXPIRED',
            pointsRestored: voucher.points_redeemed,
          }),
        });

        expired += 1;
      }
      return expired;
    });

    if (count > 0) {
      log.info('Expired due vouchers', { count });
    }
    return count;
  }
}
