import { Knex } from 'knex';

interface IndexDef {
  table: string;
  columns: string[];
  name: string;
}

const INDEXES: IndexDef[] = [
  { table: 'users', columns: ['status'], name: 'idx_users_status' },
  { table: 'users', columns: ['created_at'], name: 'idx_users_created_at' },
  { table: 'receipt_claims', columns: ['customer_id'], name: 'idx_receipt_claims_customer_id' },
  { table: 'receipt_claims', columns: ['status'], name: 'idx_receipt_claims_status' },
  { table: 'receipt_claims', columns: ['created_at'], name: 'idx_receipt_claims_created_at' },
  { table: 'points_ledger', columns: ['customer_id'], name: 'idx_points_ledger_customer_id' },
  { table: 'points_ledger', columns: ['type'], name: 'idx_points_ledger_type' },
  { table: 'points_ledger', columns: ['claim_id'], name: 'idx_points_ledger_claim_id' },
  { table: 'points_ledger', columns: ['created_at'], name: 'idx_points_ledger_created_at' },
  { table: 'points_ledger', columns: ['voucher_id'], name: 'idx_points_ledger_voucher_id' },
  {
    table: 'redemption_vouchers',
    columns: ['customer_id'],
    name: 'idx_redemption_vouchers_customer_id',
  },
  { table: 'redemption_vouchers', columns: ['status'], name: 'idx_redemption_vouchers_status' },
  { table: 'redemption_vouchers', columns: ['expires_at'], name: 'idx_redemption_vouchers_expires_at' },
  { table: 'audit_logs', columns: ['user_id'], name: 'idx_audit_logs_user_id' },
  { table: 'audit_logs', columns: ['entity_type'], name: 'idx_audit_logs_entity_type' },
  { table: 'audit_logs', columns: ['action'], name: 'idx_audit_logs_action' },
  { table: 'audit_logs', columns: ['created_at'], name: 'idx_audit_logs_created_at' },
  {
    table: 'offers',
    columns: ['is_active', 'start_date', 'end_date'],
    name: 'idx_offers_active_window',
  },
  { table: 'offers', columns: ['priority'], name: 'idx_offers_priority' },
  { table: 'notifications', columns: ['user_id', 'read'], name: 'idx_notifications_user_read' },
  { table: 'notifications', columns: ['created_at'], name: 'idx_notifications_created_at' },
  {
    table: 'contact_verifications',
    columns: ['expires_at'],
    name: 'idx_contact_verifications_expires_at',
  },
  {
    table: 'password_reset_tokens',
    columns: ['expires_at'],
    name: 'idx_password_reset_tokens_expires_at',
  },
];

const MYSQL_FKS: string[] = [
  `ALTER TABLE points_ledger ADD CONSTRAINT fk_points_ledger_voucher_id
     FOREIGN KEY (voucher_id) REFERENCES redemption_vouchers(id)`,
  `ALTER TABLE redemption_vouchers ADD CONSTRAINT fk_redemption_vouchers_used_by
     FOREIGN KEY (used_by) REFERENCES users(id)`,
  `ALTER TABLE points_ledger ADD CONSTRAINT fk_points_ledger_reversal_reference
     FOREIGN KEY (reversal_reference) REFERENCES points_ledger(id)`,
];

const MYSQL_CHECKS: string[] = [
  `ALTER TABLE users ADD CONSTRAINT chk_users_role
     CHECK (role IN ('customer','cashier','reviewer','manager','master_admin'))`,
  `ALTER TABLE users ADD CONSTRAINT chk_users_status
     CHECK (status IN ('active','suspended','deleted'))`,
  `ALTER TABLE receipt_claims ADD CONSTRAINT chk_receipt_claims_status
     CHECK (status IN ('SUBMITTED','PENDING_REVIEW','REQUEST_CLEARER_IMAGE','APPROVED','REJECTED','REVERSED'))`,
  `ALTER TABLE receipt_claims ADD CONSTRAINT chk_receipt_claims_amounts
     CHECK (submitted_amount >= 0 AND (approved_amount IS NULL OR approved_amount >= 0)
       AND (eligible_amount IS NULL OR eligible_amount >= 0))`,
  `ALTER TABLE points_ledger ADD CONSTRAINT chk_points_ledger_type
     CHECK (type IN ('PURCHASE_EARN','OFFER_BONUS','REDEMPTION','EXPIRY','REFUND_REVERSAL','MANUAL_CREDIT','MANUAL_DEBIT','CORRECTION_REVERSAL'))`,
  `ALTER TABLE points_ledger ADD CONSTRAINT chk_points_ledger_points_not_zero
     CHECK (points <> 0)`,
  `ALTER TABLE redemption_vouchers ADD CONSTRAINT chk_redemption_vouchers_status
     CHECK (status IN ('ACTIVE','USED','EXPIRED','CANCELLED'))`,
  `ALTER TABLE redemption_vouchers ADD CONSTRAINT chk_redemption_vouchers_points
     CHECK (points_redeemed > 0)`,
  `ALTER TABLE offers ADD CONSTRAINT chk_offers_type
     CHECK (offer_type IN ('multiplier','fixed_bonus','percentage_bonus','birthday','referral','coupon'))`,
  `ALTER TABLE offers ADD CONSTRAINT chk_offers_max_uses
     CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer >= 1)`,
  `ALTER TABLE offers ADD CONSTRAINT chk_offers_global_uses
     CHECK (current_global_uses >= 0 AND (global_max_uses IS NULL OR global_max_uses >= 1))`,
];

function dialect(knex: Knex): string {
  return String((knex.client as { config?: { client?: string } })?.config?.client || '');
}

function isMysql(knex: Knex): boolean {
  return dialect(knex).includes('mysql');
}

async function applyIndexes(knex: Knex): Promise<void> {
  for (const idx of INDEXES) {
    if (!(await knex.schema.hasTable(idx.table))) continue;
    await knex.schema.alterTable(idx.table, (table) => {
      table.index(idx.columns, idx.name);
    });
  }
}

export async function up(knex: Knex): Promise<void> {
  // Portable indexes (both SQLite dev + MySQL prod)
  await applyIndexes(knex);

  // FK + CHECK constraints: MySQL only.
  // SQLite cannot ALTER TABLE ADD CONSTRAINT, and PRAGMA foreign_keys is a
  // no-op inside Knex migration transactions — enforcement stays app-layer on dev.
  if (isMysql(knex)) {
    for (const sql of MYSQL_FKS) {
      await knex.raw(sql);
    }
    for (const sql of MYSQL_CHECKS) {
      await knex.raw(sql);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const idx of [...INDEXES].reverse()) {
    if (!(await knex.schema.hasTable(idx.table))) continue;
    await knex.schema.alterTable(idx.table, (table) => {
      table.dropIndex([], idx.name);
    });
  }

  if (isMysql(knex)) {
    const drops = [
      `ALTER TABLE points_ledger DROP FOREIGN KEY fk_points_ledger_voucher_id`,
      `ALTER TABLE redemption_vouchers DROP FOREIGN KEY fk_redemption_vouchers_used_by`,
      `ALTER TABLE points_ledger DROP FOREIGN KEY fk_points_ledger_reversal_reference`,
      `ALTER TABLE users DROP CHECK chk_users_role`,
      `ALTER TABLE users DROP CHECK chk_users_status`,
      `ALTER TABLE receipt_claims DROP CHECK chk_receipt_claims_status`,
      `ALTER TABLE receipt_claims DROP CHECK chk_receipt_claims_amounts`,
      `ALTER TABLE points_ledger DROP CHECK chk_points_ledger_type`,
      `ALTER TABLE points_ledger DROP CHECK chk_points_ledger_points_not_zero`,
      `ALTER TABLE redemption_vouchers DROP CHECK chk_redemption_vouchers_status`,
      `ALTER TABLE redemption_vouchers DROP CHECK chk_redemption_vouchers_points`,
      `ALTER TABLE offers DROP CHECK chk_offers_type`,
      `ALTER TABLE offers DROP CHECK chk_offers_max_uses`,
      `ALTER TABLE offers DROP CHECK chk_offers_global_uses`,
    ];
    for (const sql of drops) {
      try {
        await knex.raw(sql);
      } catch {
        // ignore missing constraints on partial rollbacks
      }
    }
  }
}
