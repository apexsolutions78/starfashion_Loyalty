import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';

interface OfferInput {
  name: string;
  description?: string;
  offerType: 'multiplier' | 'fixed_bonus' | 'percentage_bonus' | 'birthday' | 'referral' | 'coupon';
  conditions?: {
    minimumPurchaseAmount?: number;
    eligibleArticles?: string[];
    eligibleCategories?: string[];
    eligibleTiers?: string[];
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

    const [offer] = await db('offers').insert({
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
    }).returning('*');

    log.info('Offer created', { offerId: offer.id, name: input.name });
    return { ...offer, conditions: offer.conditions_json ? JSON.parse(offer.conditions_json) : null };
  }

  static async getOffers(includeInactive: boolean = false): Promise<any[]> {
    let query = db('offers');
    if (!includeInactive) {
      query = query.where('is_active', true);
    }
    const offers = await query.orderBy('priority', 'desc');
    return offers.map((o) => ({
      ...o,
      conditions: o.conditions_json ? JSON.parse(o.conditions_json) : null,
    }));
  }

  static async getOfferById(id: string): Promise<any> {
    const offer = await db('offers').where('id', id).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }
    return { ...offer, conditions: offer.conditions_json ? JSON.parse(offer.conditions_json) : null };
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
      action: 'OFFER_DEACTIVATED',
      entity_type: 'offer',
      entity_id: id,
      old_values: JSON.stringify({ isActive: true }),
      new_values: JSON.stringify({ isActive: false }),
    });

    log.info('Offer deactivated', { offerId: id });
  }

  static async getActiveOffers(): Promise<any[]> {
    const now = new Date();
    const offers = await db('offers')
      .where('is_active', true)
      .where('start_date', '<=', now)
      .where('end_date', '>=', now)
      .orderBy('priority', 'desc');

    return offers.map((o) => ({
      ...o,
      conditions: o.conditions_json ? JSON.parse(o.conditions_json) : null,
    }));
  }

  static async checkOfferUsage(offerId: string, customerId: string): Promise<{ canUse: boolean; usesRemaining: number }> {
    const offer = await db('offers').where('id', offerId).first();
    if (!offer) {
      throw createAppError('Offer not found', 404, 'OFFER_NOT_FOUND');
    }

    const customerUses = await db('points_ledger')
      .where('customer_id', customerId)
      .whereRaw("JSON_EXTRACT(offer_snapshot, '$.id') = ?", [offerId])
      .count('* as uses')
      .first();

    const uses = Number(customerUses?.uses || 0);
    const usesRemaining = (offer.max_uses_per_customer || 1) - uses;

    return {
      canUse: usesRemaining > 0,
      usesRemaining: Math.max(0, usesRemaining),
    };
  }
}
