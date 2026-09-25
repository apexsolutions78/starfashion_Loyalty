import { db } from '../config/database';
import type { Knex } from 'knex';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { newId } from '../utils/crypto';
import { serializeOffer } from '../utils/serialize';

type Db = Knex | Knex.Transaction;

interface OfferInput {
  name: string;
  description?: string;
  offerType: 'multiplier' | 'fixed_bonus' | 'percentage_bonus' | 'birthday' | 'referral' | 'coupon';
  conditions?: {
    minimumPurchaseAmount?: number;
    eligibleArticles?: string[];
    eligibleCategories?: string[];
    eligibleTiers?: string[];
    multiplier?: number;
    bonusPoints?: number;
    bonusPercentage?: number;
  };
  startDate: Date;
  endDate: Date;
  maxUsesPerCustomer?: number;
  globalMaxUses?: number;
  priority?: number;
  stackable?: boolean;
  terms?: string;
}

export class OfferService {
  static async createOffer(input: OfferInput, createdBy: string, requestId: string): Promise<any> {
    const log = createRequestLogger(requestId);

    const offerId = newId();
    await db('offers').insert({
      id: offerId,
      name: input.name,
      description: input.description,
      offer_type: input.offerType,
      conditions_json: input.conditions ? JSON.stringify(input.conditions) : null,
      start_date: input.startDate,
      end_date: input.endDate,
      is_active: false,
      max_uses_per_customer: input.maxUsesPerCustomer || 1,
      global_max_uses: input.globalMaxUses || null,
      priority: input.priority || 0,
      stackable: input.stackable || false,
      terms: input.terms,
      created_by: createdBy,
    });

    // Re-select instead of `.returning('*')` — MySQL ignores RETURNING.
    const offer = await db('offers').where('id', offerId).first();

    log.info('Offer created', { offerId, name: input.name });
    return serializeOffer({ ...offer });
  }

  static async getOffers(includeInactive: boolean = false): Promise<any[]> {
    let query = db('offers');
    if (!includeInactive) {
      query = query.where('is_active', true);
    }
    const offers = await query.orderBy('priority', 'desc');
    return offers.map((o) => serializeOffer(o as Record<string, any>));
  }

  static async getOfferById(id: string): Promise<any> {
    const offer = await db('offers').where('id', id).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }
    return serializeOffer(offer as Record<string, any>);
  }

  static async updateOffer(id: string, input: Partial<OfferInput>, requestId: string): Promise<any> {
    const log = createRequestLogger(requestId);

    const offer = await db('offers').where('id', id).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }

    const updateData: any = { updated_at: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.offerType) updateData.offer_type = input.offerType;
    if (input.conditions) updateData.conditions_json = JSON.stringify(input.conditions);
    if (input.startDate) updateData.start_date = input.startDate;
    if (input.endDate) updateData.end_date = input.endDate;
    if (input.maxUsesPerCustomer !== undefined) updateData.max_uses_per_customer = input.maxUsesPerCustomer;
    if (input.globalMaxUses !== undefined) updateData.global_max_uses = input.globalMaxUses;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.stackable !== undefined) updateData.stackable = input.stackable;
    if (input.terms !== undefined) updateData.terms = input.terms;

    await db('offers').where('id', id).update(updateData);

    log.info('Offer updated', { offerId: id });
    return this.getOfferById(id);
  }

  static async activateOffer(id: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const offer = await db('offers').where('id', id).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }

    const now = new Date();
    if (now < new Date(offer.start_date) || now > new Date(offer.end_date)) {
      throw createAppError('Offer is not within its valid date range', 400, 'OFFER_DATE_INVALID');
    }

    await db('offers').where('id', id).update({ is_active: true });

    await db('audit_logs').insert({
      id: newId(),
      action: 'OFFER_ACTIVATED',
      entity_type: 'offer',
      entity_id: id,
      new_values: JSON.stringify({ name: offer.name }),
    });

    log.info('Offer activated', { offerId: id });
  }

  static async deactivateOffer(id: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const offer = await db('offers').where('id', id).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }

    await db('offers').where('id', id).update({ is_active: false });

    await db('audit_logs').insert({
      id: newId(),
      action: 'OFFER_DEACTIVATED',
      entity_type: 'offer',
      entity_id: id,
      old_values: JSON.stringify({ isActive: true }),
      new_values: JSON.stringify({ isActive: false }),
    });

    log.info('Offer deactivated', { offerId: id });
  }

  static async getActiveOffers(client: Db = db): Promise<any[]> {
    const now = new Date();
    const offers = await client('offers')
      .where('is_active', true)
      .where('start_date', '<=', now)
      .where('end_date', '>=', now)
      .orderBy('priority', 'desc');

    return offers.map((o) => serializeOffer(o as Record<string, any>));
  }

  static async checkOfferUsage(
    offerId: string,
    customerId: string,
    client: Db = db,
  ): Promise<{ canUse: boolean; usesRemaining: number }> {
    const offer = await client('offers').where('id', offerId).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }

    // Portable across SQLite + MySQL (avoids MySQL-only JSON_EXTRACT)
    const rows = await client('points_ledger')
      .where('customer_id', customerId)
      .whereNotNull('offer_snapshot')
      .select('offer_snapshot');

    let uses = 0;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(String(row.offer_snapshot));
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (list.some((o: any) => o && o.id === offerId)) {
          uses += 1;
        }
      } catch {
        // ignore malformed snapshots
      }
    }

    const maxUses = offer.max_uses_per_customer == null ? 1 : Number(offer.max_uses_per_customer);
    const usesRemaining = maxUses - uses;

    return {
      canUse: usesRemaining > 0,
      usesRemaining: Math.max(0, usesRemaining),
    };
  }

  static async recordOfferUse(
    offerId: string,
    client: Db = db,
  ): Promise<boolean> {
    const updated = await client('offers')
      .where('id', offerId)
      .where(function () {
        this.whereNull('global_max_uses').orWhereRaw('current_global_uses < global_max_uses');
      })
      .increment('current_global_uses', 1);
    return Number(updated) > 0;
  }
}
