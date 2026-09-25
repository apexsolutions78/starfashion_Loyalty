import { db } from '../config/database';
import type { Knex } from 'knex';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';
import { newId } from '../utils/crypto';

type Db = Knex | Knex.Transaction;

export interface ArticleCategoryInput {
  category: string;
  articlePrefix: string;
  description?: string;
}

function normalizePrefix(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function serialize(row: Record<string, any>): Record<string, any> {
  return {
    id: row.id,
    category: row.category,
    articlePrefix: row.article_prefix,
    description: row.description ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export class ArticleCategoryService {
  static async list(client: Db = db): Promise<Record<string, any>[]> {
    const rows = await client('article_categories').orderBy('category', 'asc');
    return rows.map((r) => serialize(r as Record<string, any>));
  }

  static async create(
    input: ArticleCategoryInput,
    actorId: string,
    requestId: string,
  ): Promise<Record<string, any>> {
    const log = createRequestLogger(requestId);
    const prefix = normalizePrefix(input.articlePrefix);

    if (!prefix) {
      throw createAppError('Article prefix is required', 400, 'INVALID_PREFIX');
    }

    const existing = await db('article_categories').where('article_prefix', prefix).first();
    if (existing) {
      throw createAppError('That article prefix already exists', 409, 'PREFIX_ALREADY_EXISTS');
    }

    const id = newId();
    await db('article_categories').insert({
      id,
      category: input.category.trim(),
      article_prefix: prefix,
      description: input.description ?? null,
      created_by: actorId,
    });

    // Re-select instead of `.returning('*')` — MySQL ignores RETURNING.
    const row = await db('article_categories').where('id', id).first();

    log.info('Article category created', { category: input.category, prefix });
    return serialize(row as Record<string, any>);
  }

  static async update(
    id: string,
    input: Partial<ArticleCategoryInput>,
    requestId: string,
  ): Promise<Record<string, any>> {
    const log = createRequestLogger(requestId);

    const row = await db('article_categories').where('id', id).first();
    if (!row) {
      throw createAppError('Article category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    const updateData: Record<string, any> = { updated_at: new Date() };

    if (input.category !== undefined) updateData.category = input.category.trim();
    if (input.description !== undefined) updateData.description = input.description;

    if (input.articlePrefix !== undefined) {
      const prefix = normalizePrefix(input.articlePrefix);
      if (!prefix) {
        throw createAppError('Article prefix is required', 400, 'INVALID_PREFIX');
      }
      const clash = await db('article_categories')
        .where('article_prefix', prefix)
        .whereNot('id', id)
        .first();
      if (clash) {
        throw createAppError('That article prefix already exists', 409, 'PREFIX_ALREADY_EXISTS');
      }
      updateData.article_prefix = prefix;
    }

    await db('article_categories').where('id', id).update(updateData);

    // Re-select instead of `.returning('*')` — MySQL ignores RETURNING.
    const updated = await db('article_categories').where('id', id).first();
    log.info('Article category updated', { id });
    return serialize(updated as Record<string, any>);
  }

  static async remove(id: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const row = await db('article_categories').where('id', id).first();
    if (!row) {
      throw createAppError('Article category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    await db('article_categories').where('id', id).del();
    log.info('Article category deleted', { id });
  }

  static async setCustomerTier(
    customerId: string,
    tier: string,
    actorId: string,
    requestId: string,
  ): Promise<void> {
    const log = createRequestLogger(requestId);
    const normalized = tier.trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(normalized)) {
      throw createAppError('Invalid tier name', 400, 'INVALID_TIER');
    }

    const customer = await db('users').where('id', customerId).where('role', 'customer').first();
    if (!customer) {
      throw createAppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    const profile = await db('customer_profiles').where('user_id', customerId).first();
    if (!profile) {
      throw createAppError('Customer profile not found', 404, 'PROFILE_NOT_FOUND');
    }

    const oldTier = profile.tier ?? 'standard';

    await db('customer_profiles')
      .where('user_id', customerId)
      .update({ tier: normalized, updated_at: new Date() });

    await db('audit_logs').insert({
      id: newId(),
      user_id: actorId,
      action: 'CUSTOMER_TIER_CHANGED',
      entity_type: 'customer_profile',
      entity_id: profile.id,
      old_values: JSON.stringify({ tier: oldTier }),
      new_values: JSON.stringify({ tier: normalized }),
    });

    log.info('Customer tier changed', { customerId, oldTier, tier: normalized });
  }
}
