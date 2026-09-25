import { db } from '../config/database';
import type { Knex } from 'knex';

type Db = Knex | Knex.Transaction;

export interface OfferEligibilityContext {
  customerId: string;
  articles: string[];
  categories: string[];
  tier: string | null;
}

function normalize(value: string): string {
  return String(value).trim().toUpperCase();
}

function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).filter((v) => v.trim() !== '');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter((v) => v.trim() !== '');
    } catch {
      return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

/**
 * Resolves submitted article numbers into the categories declared by the
 * admin-managed `article_categories` lookup table. A row matches when the
 * article equals the configured prefix or starts with it (case-insensitive).
 */
export async function resolveArticleCategories(
  articles: string[],
  client: Db = db,
): Promise<string[]> {
  if (articles.length === 0) return [];

  const rows = await client('article_categories').select('category', 'article_prefix');
  if (rows.length === 0) return [];

  const normalizedArticles = articles.map(normalize);
  const matched = new Set<string>();

  for (const row of rows) {
    const prefix = normalize(row.article_prefix);
    if (!prefix) continue;
    if (normalizedArticles.some((a) => a === prefix || a.startsWith(prefix))) {
      matched.add(String(row.category));
    }
  }

  return Array.from(matched);
}

export async function getCustomerTier(
  customerId: string,
  client: Db = db,
): Promise<string | null> {
  const profile = await client('customer_profiles')
    .where('user_id', customerId)
    .select('tier')
    .first();

  const tier = profile?.tier;
  return tier == null || String(tier).trim() === '' ? null : String(tier).trim().toLowerCase();
}

export async function buildEligibilityContext(
  customerId: string,
  articles: unknown,
  client: Db = db,
): Promise<OfferEligibilityContext> {
  const list = asStringArray(articles);
  const [categories, tier] = await Promise.all([
    resolveArticleCategories(list, client),
    getCustomerTier(customerId, client),
  ]);

  return { customerId, articles: list.map(normalize), categories, tier };
}

/**
 * Offer eligibility is strict: when an offer declares a constraint and the
 * claim provides no matching data, the offer does not apply.
 */
export function isOfferEligible(
  offer: { conditions?: unknown },
  ctx: OfferEligibilityContext,
): boolean {
  const conditions = (offer.conditions || {}) as Record<string, unknown>;

  const eligibleArticles = asStringArray(conditions.eligibleArticles);
  if (eligibleArticles.length > 0) {
    const wanted = eligibleArticles.map(normalize);
    if (ctx.articles.length === 0) return false;
    if (!ctx.articles.some((a) => wanted.includes(a))) return false;
  }

  const eligibleCategories = asStringArray(conditions.eligibleCategories);
  if (eligibleCategories.length > 0) {
    const wanted = eligibleCategories.map((c) => String(c).trim().toLowerCase());
    if (ctx.categories.length === 0) return false;
    if (!ctx.categories.some((c) => wanted.includes(c.toLowerCase()))) return false;
  }

  const eligibleTiers = asStringArray(conditions.eligibleTiers);
  if (eligibleTiers.length > 0) {
    if (!ctx.tier) return false;
    const wanted = eligibleTiers.map((t) => String(t).trim().toLowerCase());
    if (!wanted.includes(ctx.tier)) return false;
  }

  return true;
}
