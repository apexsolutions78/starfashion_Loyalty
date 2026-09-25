export function parseDateValue(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: unknown): string | null {
  const d = parseDateValue(value);
  return d ? d.toISOString() : null;
}

function parseArticles(value: unknown): string[] | null {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [String(value)];
  } catch {
    return [String(value)];
  }
}

export function serializeClaim(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  return {
    id: row.id,
    customerId: row.customerId ?? row.customer_id,
    receiptNumber: row.receiptNumber ?? row.receipt_number,
    purchaseDate: toIso(row.purchaseDate ?? row.purchase_date),
    submittedAmount: Number(row.submittedAmount ?? row.submitted_amount ?? 0),
    submittedArticles:
      row.submittedArticles !== undefined
        ? parseArticles(row.submittedArticles)
        : parseArticles(row.submitted_articles),
    // Never expose the server filesystem path — images are served only through
    // authorization-checked endpoints (GET /api/claims/:id/image, GET /api/review/claims/:id/image).
    imageAvailable: Boolean(row.receiptImagePath ?? row.receipt_image_path),
    status: row.status,
    approvedAmount:
      row.approvedAmount != null
        ? Number(row.approvedAmount)
        : row.approved_amount != null
          ? Number(row.approved_amount)
          : null,
    eligibleAmount:
      row.eligibleAmount != null
        ? Number(row.eligibleAmount)
        : row.eligible_amount != null
          ? Number(row.eligible_amount)
          : null,
    reviewerNotes: row.reviewerNotes ?? row.reviewer_notes ?? null,
    rejectionReason: row.rejectionReason ?? row.rejection_reason ?? null,
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    reviewedAt: toIso(row.reviewedAt ?? row.reviewed_at),
    ruleSnapshot: row.ruleSnapshot ?? row.rule_snapshot ?? null,
    offerSnapshot: row.offerSnapshot ?? row.offer_snapshot ?? null,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
    customerEmail: row.customerEmail ?? row.customer_email ?? null,
    customerName: row.customerName ?? row.customer_name ?? null,
    customerMobile: row.customerMobile ?? row.customer_mobile ?? null,
  };
}

function parseJsonSafe(value: unknown): unknown {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function serializeOffer(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    offerType: row.offerType ?? row.offer_type,
    conditions: parseJsonSafe(row.conditions ?? row.conditions_json),
    startDate: toIso(row.startDate ?? row.start_date),
    endDate: toIso(row.endDate ?? row.end_date),
    isActive: Boolean(row.isActive ?? row.is_active),
    maxUsesPerCustomer: row.maxUsesPerCustomer ?? row.max_uses_per_customer ?? 1,
    globalMaxUses: row.globalMaxUses ?? row.global_max_uses ?? null,
    currentGlobalUses: Number(row.currentGlobalUses ?? row.current_global_uses ?? 0),
    priority: Number(row.priority ?? 0),
    stackable: Boolean(row.stackable),
    terms: row.terms ?? null,
    createdBy: row.createdBy ?? row.created_by ?? null,
    createdAt: toIso(row.createdAt ?? row.created_at),
    updatedAt: toIso(row.updatedAt ?? row.updated_at),
  };
}

export function serializeNotification(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.userId ?? row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    data: (() => {
      const raw = row.data ?? row.data_json;
      if (!raw) return null;
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
    })(),
    read: Boolean(row.read),
    createdAt: toIso(row.createdAt ?? row.created_at),
  };
}
