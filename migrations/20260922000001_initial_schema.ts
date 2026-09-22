import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Users table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.enum('role', ['customer', 'cashier', 'reviewer', 'manager', 'master_admin']).notNullable().defaultTo('customer');
    table.string('email', 255).notNullable().unique();
    table.string('mobile', 20).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.enum('status', ['active', 'suspended', 'deleted']).notNullable().defaultTo('active');
    table.boolean('email_verified').notNullable().defaultTo(false);
    table.boolean('mobile_verified').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('status');
    table.index('created_at');
  });

  // Customer profiles
  await knex.schema.createTable('customer_profiles', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.string('full_name', 255).notNullable();
    table.string('avatar_url', 500);
    table.boolean('marketing_consent').notNullable().defaultTo(false);
    table.boolean('loyalty_consent').notNullable().defaultTo(false);
    table.timestamp('date_of_birth');
    table.string('gender', 20);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Admin profiles
  await knex.schema.createTable('admin_profiles', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.string('full_name', 255).notNullable();
    table.string('department', 100);
    table.boolean('mfa_enabled').notNullable().defaultTo(false);
    table.string('mfa_secret', 255);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Contact verifications
  await knex.schema.createTable('contact_verifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.enum('type', ['email', 'mobile']).notNullable();
    table.string('token_hash', 255).notNullable();
    table.string('contact_value', 255).notNullable();
    table.timestamp('expires_at').notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(5);
    table.boolean('used').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'type']);
    table.index('expires_at');
  });

  // Password reset tokens
  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 255).notNullable();
    table.timestamp('expires_at').notNullable();
    table.boolean('used').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index('user_id');
    table.index('expires_at');
  });

  // Consents
  await knex.schema.createTable('consents', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('consent_type', 100).notNullable();
    table.boolean('granted').notNullable();
    table.string('ip_address', 45);
    table.string('user_agent', 500);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'consent_type']);
  });

  // Loyalty rules (versioned)
  await knex.schema.createTable('loyalty_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.integer('version').notNullable().defaultTo(1);
    table.string('name', 255).notNullable();
    table.json('rules_json').notNullable();
    table.boolean('is_active').notNullable().defaultTo(false);
    table.timestamp('effective_from').notNullable();
    table.timestamp('effective_to');
    table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('is_active');
    table.index('effective_from');
  });

  // Offers
  await knex.schema.createTable('offers', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 255).notNullable();
    table.text('description');
    table.enum('offer_type', ['multiplier', 'fixed_bonus', 'percentage_bonus', 'birthday', 'referral', 'coupon']).notNullable();
    table.json('conditions_json');
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date').notNullable();
    table.boolean('is_active').notNullable().defaultTo(false);
    table.integer('max_uses_per_customer').defaultTo(1);
    table.integer('global_max_uses');
    table.integer('current_global_uses').notNullable().defaultTo(0);
    table.integer('priority').notNullable().defaultTo(0);
    table.boolean('stackable').notNullable().defaultTo(false);
    table.text('terms');
    table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index('is_active');
    table.index(['start_date', 'end_date']);
  });

  // Receipt claims
  await knex.schema.createTable('receipt_claims', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('customer_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('receipt_number', 100).notNullable();
    table.date('purchase_date').notNullable();
    table.decimal('submitted_amount', 12, 2).notNullable();
    table.json('submitted_articles');
    table.string('receipt_image_path', 500).notNullable();
    table.enum('status', [
      'SUBMITTED',
      'PENDING_REVIEW',
      'REQUEST_CLEARER_IMAGE',
      'APPROVED',
      'REJECTED',
      'REVERSED',
    ]).notNullable().defaultTo('SUBMITTED');
    table.decimal('approved_amount', 12, 2);
    table.decimal('eligible_amount', 12, 2);
    table.text('reviewer_notes');
    table.text('rejection_reason');
    table.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('reviewed_at');
    table.json('rule_snapshot');
    table.json('offer_snapshot');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['receipt_number']);
    table.index('customer_id');
    table.index('status');
    table.index('created_at');
    table.index('receipt_number');
  });

  // Points ledger (append-only)
  await knex.schema.createTable('points_ledger', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('customer_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('claim_id').references('id').inTable('receipt_claims').onDelete('SET NULL');
    table.uuid('voucher_id');
    table.enum('type', [
      'PURCHASE_EARN',
      'OFFER_BONUS',
      'REDEMPTION',
      'EXPIRY',
      'REFUND_REVERSAL',
      'MANUAL_CREDIT',
      'MANUAL_DEBIT',
      'CORRECTION_REVERSAL',
    ]).notNullable();
    table.integer('points').notNullable();
    table.json('rule_snapshot');
    table.json('offer_snapshot');
    table.string('idempotency_key', 255).notNullable().unique();
    table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.text('reason');
    table.uuid('reversal_reference');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index('customer_id');
    table.index(['customer_id', 'created_at']);
    table.index('claim_id');
    table.index('type');
    table.index('created_at');
  });

  // Redemption vouchers
  await knex.schema.createTable('redemption_vouchers', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('customer_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('voucher_code', 50).notNullable().unique();
    table.integer('points_redeemed').notNullable();
    table.decimal('discount_amount', 12, 2).notNullable();
    table.enum('status', ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED']).notNullable().defaultTo('ACTIVE');
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at');
    table.uuid('used_by');
    table.uuid('ledger_entry_id').references('id').inTable('points_ledger').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index('customer_id');
    table.index('status');
    table.index('expires_at');
    table.index('voucher_code');
  });

  // Notifications
  await knex.schema.createTable('notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('type', 100).notNullable();
    table.string('title', 255).notNullable();
    table.text('message');
    table.json('data_json');
    table.boolean('read').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'read']);
    table.index('created_at');
  });

  // Audit logs
  await knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('action', 100).notNullable();
    table.string('entity_type', 100).notNullable();
    table.uuid('entity_id');
    table.json('old_values');
    table.json('new_values');
    table.string('ip_address', 45);
    table.string('user_agent', 500);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id']);
    table.index(['entity_type', 'entity_id']);
    table.index('action');
    table.index('created_at');
  });

  // System settings
  await knex.schema.createTable('system_settings', (table) => {
    table.string('key', 255).primary();
    table.text('value');
    table.text('description');
    table.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
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
