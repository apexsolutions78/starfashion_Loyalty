import { Knex } from 'knex';

const DAY_MS = 24 * 60 * 60 * 1000;

function readExpiryDays(rulesJson: unknown): number {
  try {
    const parsed = JSON.parse(String(rulesJson)) as { pointExpiryDays?: number | null };
    const days = Number(parsed?.pointExpiryDays ?? 0);
    return Number.isFinite(days) && days > 0 ? days : 0;
  } catch {
    return 0;
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('points_ledger'))) return;

  const hasExpiresAt = await knex.schema.hasColumn('points_ledger', 'expires_at');
  const hasExpiredAt = await knex.schema.hasColumn('points_ledger', 'expired_at');
  const hasExpiredPoints = await knex.schema.hasColumn('points_ledger', 'expired_points');

  await knex.schema.alterTable('points_ledger', (table) => {
    if (!hasExpiresAt) table.timestamp('expires_at');
    if (!hasExpiredAt) table.timestamp('expired_at');
    if (!hasExpiredPoints) table.integer('expired_points').notNullable().defaultTo(0);
  });

  // Historical credits predate expires_at. Stamp them from the rule that is
  // active now, otherwise every point earned before this migration would be
  // exempt from expiry forever.
  const now = new Date();
  const rule = await knex('loyalty_rules')
    .where('is_active', true)
    .where('effective_from', '<=', now)
    .where(function () {
      this.whereNull('effective_to').orWhere('effective_to', '>', now);
    })
    .orderBy('version', 'desc')
    .first();

  const days = rule ? readExpiryDays(rule.rules_json) : 0;
  if (days === 0) return;

  const rows = await knex('points_ledger')
    .whereNull('expires_at')
    .where('points', '>', 0)
    .select('id', 'created_at');

  for (const row of rows) {
    const createdAt = new Date(row.created_at as string | Date).getTime();
    await knex('points_ledger')
      .where('id', row.id)
      .update({ expires_at: new Date(createdAt + days * DAY_MS) });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('points_ledger'))) return;

  for (const column of ['expires_at', 'expired_at', 'expired_points']) {
    if (await knex.schema.hasColumn('points_ledger', column)) {
      await knex.schema.alterTable('points_ledger', (table) => table.dropColumn(column));
    }
  }
}
