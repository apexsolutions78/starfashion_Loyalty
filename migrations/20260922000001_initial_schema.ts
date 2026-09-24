import { Knex } from 'knex';
import { randomUUID } from 'crypto';

function uuid(): string {
  return randomUUID();
}

export async function up(knex: Knex): Promise<void> {
  // Users table
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('role').notNullable().defaultTo('customer');
    table.string('email', 255).notNullable().unique();
    table.string('mobile', 20).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('status').notNullable().defaultTo('active');
    table.boolean('email_verified').notNullable().defaultTo(false);
    table.boolean('mobile_verified').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Customer profiles
  await knex.schema.createTable('customer_profiles', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().unique().references('id').inTable('users');
    table.string('full_name', 255).notNullable();
    table.string('avatar_url', 500);
    table.boolean('marketing_consent').notNullable().defaultTo(false);
    table.boolean('loyalty_consent').notNullable().defaultTo(false);
    table.string('date_of_birth');
    table.string('gender', 20);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Admin profiles
  await knex.schema.createTable('admin_profiles', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().unique().references('id').inTable('users');
    table.string('full_name', 255).notNullable();
    table.string('department', 100);
    table.boolean('mfa_enabled').notNullable().defaultTo(false);
    table.string('mfa_secret', 255);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Contact verifications
  await knex.schema.createTable('contact_verifications', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().references('id').inTable('users');
    table.string('type', 10).notNullable();
    table.string('token_hash', 255).notNullable();
    table.string('contact_value', 255).notNullable();
    table.timestamp('expires_at').notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(5);
    table.boolean('used').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Password reset tokens
  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().references('id').inTable('users');
    table.string('token_hash', 255).notNullable();
    table.timestamp('expires_at').notNullable();
    table.boolean('used').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Consents
  await knex.schema.createTable('consents', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().references('id').inTable('users');
    table.string('consent_type', 100).notNullable();
    table.boolean('granted').notNullable();
    table.string('ip_address', 45);
    table.string('user_agent', 500);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Loyalty rules (versioned)
  await knex.schema.createTable('loyalty_rules', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.integer('version').notNullable().defaultTo(1);
    table.string('name', 255).notNullable();
    table.text('rules_json').notNullable();
    table.boolean('is_active').notNullable().defaultTo(false);
    table.timestamp('effective_from').notNullable();
    table.timestamp('effective_to');
    table.string('created_by').references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Offers
  await knex.schema.createTable('offers', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('offer_type', 50).notNullable();
    table.text('conditions_json');
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date').notNullable();
    table.boolean('is_active').notNullable().defaultTo(false);
    table.integer('max_uses_per_customer').defaultTo(1);
    table.integer('global_max_uses');
    table.integer('current_global_uses').notNullable().defaultTo(0);
    table.integer('priority').notNullable().defaultTo(0);
    table.boolean('stackable').notNullable().defaultTo(false);
    table.text('terms');
    table.string('created_by').references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Receipt claims
  await knex.schema.createTable('receipt_claims', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('customer_id').notNullable().references('id').inTable('users');
    table.string('receipt_number', 100).notNullable().unique();
    table.string('purchase_date', 10).notNullable();
    table.decimal('submitted_amount', 12, 2).notNullable();
    table.text('submitted_articles');
    table.string('receipt_image_path', 500).notNullable();
    table.string('status', 30).notNullable().defaultTo('SUBMITTED');
    table.decimal('approved_amount', 12, 2);
    table.decimal('eligible_amount', 12, 2);
    table.text('reviewer_notes');
    table.text('rejection_reason');
    table.string('reviewed_by').references('id').inTable('users');
    table.timestamp('reviewed_at');
    table.text('rule_snapshot');
    table.text('offer_snapshot');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Points ledger (append-only)
  await knex.schema.createTable('points_ledger', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('customer_id').notNullable().references('id').inTable('users');
    table.string('claim_id').references('id').inTable('receipt_claims');
    table.string('voucher_id');
    table.string('type', 30).notNullable();
    table.integer('points').notNullable();
    table.text('rule_snapshot');
    table.text('offer_snapshot');
    table.string('idempotency_key', 255).notNullable().unique();
    table.string('created_by').references('id').inTable('users');
    table.text('reason');
    table.string('reversal_reference');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Redemption vouchers
  await knex.schema.createTable('redemption_vouchers', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('customer_id').notNullable().references('id').inTable('users');
    table.string('voucher_code', 50).notNullable().unique();
    table.integer('points_redeemed').notNullable();
    table.decimal('discount_amount', 12, 2).notNullable();
    table.string('status', 20).notNullable().defaultTo('ACTIVE');
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at');
    table.string('used_by');
    table.string('ledger_entry_id').references('id').inTable('points_ledger');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Notifications
  await knex.schema.createTable('notifications', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').notNullable().references('id').inTable('users');
    table.string('type', 100).notNullable();
    table.string('title', 255).notNullable();
    table.text('message');
    table.text('data_json');
    table.boolean('read').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Audit logs
  await knex.schema.createTable('audit_logs', (table) => {
    table.string('id').primary().defaultTo(uuid());
    table.string('user_id').references('id').inTable('users');
    table.string('action', 100).notNullable();
    table.string('entity_type', 100).notNullable();
    table.string('entity_id');
    table.text('old_values');
    table.text('new_values');
    table.string('ip_address', 45);
    table.string('user_agent', 500);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // System settings
  await knex.schema.createTable('system_settings', (table) => {
    table.string('key', 255).primary();
    table.text('value');
    table.text('description');
    table.string('updated_by').references('id').inTable('users');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_settings');
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('redemption_vouchers');
  await knex.schema.dropTableIfExists('points_ledger');
  await knex.schema.dropTableIfExists('receipt_claims');
  await knex.schema.dropTableIfExists('offers');
  await knex.schema.dropTableIfExists('loyalty_rules');
  await knex.schema.dropTableIfExists('consents');
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('contact_verifications');
  await knex.schema.dropTableIfExists('admin_profiles');
  await knex.schema.dropTableIfExists('customer_profiles');
  await knex.schema.dropTableIfExists('users');
}
