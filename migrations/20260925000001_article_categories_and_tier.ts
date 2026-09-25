import { Knex } from 'knex';
import { randomUUID } from 'crypto';

function uuid(): string {
  return randomUUID();
}

const CATEGORIES = [
  { id: uuid(), category: 'three-piece', article_prefix: 'SF-3PC', description: 'Ready-made 3-piece suits' },
  { id: uuid(), category: 'two-piece', article_prefix: 'SF-2PC', description: 'Ready-made 2-piece suits' },
  { id: uuid(), category: 'stitched', article_prefix: 'SF-STCH', description: 'Stitched articles' },
  { id: uuid(), category: 'unstitched', article_prefix: 'SF-UNST', description: 'Unstitched fabric' },
];

export async function up(knex: Knex): Promise<void> {
  const hasUsers = await knex.schema.hasTable('users');
  const hasProfiles = await knex.schema.hasTable('customer_profiles');

  if (!(await knex.schema.hasTable('article_categories'))) {
    await knex.schema.createTable('article_categories', (table) => {
      table.string('id', 36).primary().defaultTo(uuid());
      table.string('category', 100).notNullable();
      table.string('article_prefix', 100).notNullable().unique();
      table.text('description');
      if (hasUsers) {
        table.string('created_by', 36).references('id').inTable('users');
      } else {
        table.string('created_by', 36);
      }
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (hasProfiles) {
    const hasTier = await knex.schema.hasColumn('customer_profiles', 'tier');
    if (!hasTier) {
      await knex.schema.alterTable('customer_profiles', (table) => {
        table.string('tier', 50).notNullable().defaultTo('standard');
      });
    }
  }

  const existing = await knex('article_categories').select('article_prefix');
  const known = new Set(existing.map((r) => String(r.article_prefix)));
  const toInsert = CATEGORIES.filter((c) => !known.has(c.article_prefix));
  if (toInsert.length > 0) {
    await knex('article_categories').insert(toInsert);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('article_categories')) {
    await knex.schema.dropTableIfExists('article_categories');
  }
  if (await knex.schema.hasTable('customer_profiles')) {
    const hasTier = await knex.schema.hasColumn('customer_profiles', 'tier');
    if (hasTier) {
      await knex.schema.alterTable('customer_profiles', (table) => {
        table.dropColumn('tier');
      });
    }
  }
}
