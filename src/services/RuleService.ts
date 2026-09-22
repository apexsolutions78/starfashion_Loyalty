import { db } from '../config/database';
import { createAppError } from '../middleware/errorHandler';
import { createRequestLogger } from '../utils/logger';

interface RuleInput {
  name: string;
  rules: {
    currencyThreshold: number;
    pointsPerThreshold: number;
    minimumPurchaseAmount: number;
    eligibleCategories: string[];
    excludedCategories: string[];
    maxPointsPerClaim: number;
    pointExpiryDays: number | null;
    redemptionConversion: number;
    minimumRedemptionPoints: number;
    maxRedemptionPercentage: number;
    maxFixedDiscount: number;
    earnOnPointsPayment: boolean;
    claimSubmissionWindowDays: number;
  };
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export class RuleService {
  static async createRule(input: RuleInput, createdBy: string, requestId: string): Promise<any> {
    const log = createRequestLogger(requestId);

    const lastRule = await db('loyalty_rules').orderBy('version', 'desc').first();
    const nextVersion = lastRule ? lastRule.version + 1 : 1;

    const [rule] = await db('loyalty_rules').insert({
      version: nextVersion,
      name: input.name,
      rules_json: JSON.stringify(input.rules),
      is_active: false,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo || null,
      created_by: createdBy,
    }).returning('*');

    log.info('Rule created', { ruleId: rule.id, version: nextVersion });
    return { ...rule, rules: JSON.parse(rule.rules_json) };
  }

  static async getRules(): Promise<any[]> {
    const rules = await db('loyalty_rules').orderBy('version', 'desc');
    return rules.map((r) => ({ ...r, rules: JSON.parse(r.rules_json) }));
  }

  static async getRuleById(id: string): Promise<any> {
    const rule = await db('loyalty_rules').where('id', id).first();
    if (!rule) {
      throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
    }
    return { ...rule, rules: JSON.parse(rule.rules_json) };
  }

  static async updateRule(
    id: string,
    input: Partial<RuleInput>,
    requestId: string,
  ): Promise<any> {
    const log = createRequestLogger(requestId);

    const rule = await db('loyalty_rules').where('id', id).first();
    if (!rule) {
      throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
    }

    if (rule.is_active) {
      throw createAppError('Cannot edit active rule. Create a new version instead.', 400, 'RULE_ACTIVE');
    }

    const updateData: any = { updated_at: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.rules) updateData.rules_json = JSON.stringify(input.rules);
    if (input.effectiveFrom) updateData.effective_from = input.effectiveFrom;
    if (input.effectiveTo) updateData.effective_to = input.effectiveTo;

    await db('loyalty_rules').where('id', id).update(updateData);

    log.info('Rule updated', { ruleId: id });
    return this.getRuleById(id);
  }

  static async activateRule(id: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const rule = await db('loyalty_rules').where('id', id).first();
    if (!rule) {
      throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
    }

    await db.transaction(async (trx) => {
      await trx('loyalty_rules')
        .where('is_active', true)
        .update({ is_active: false });

      await trx('loyalty_rules')
        .where('id', id)
        .update({ is_active: true });

      await trx('audit_logs').insert({
        action: 'RULE_ACTIVATED',
        entity_type: 'loyalty_rule',
        entity_id: id,
        new_values: JSON.stringify({ version: rule.version, name: rule.name }),
      });
    });

    log.info('Rule activated', { ruleId: id, version: rule.version });
  }

  static async deactivateRule(id: string, requestId: string): Promise<void> {
    const log = createRequestLogger(requestId);

    const rule = await db('loyalty_rules').where('id', id).first();
    if (!rule) {
      throw createAppError('Rule not found', 404, 'RULE_NOT_FOUND');
    }

    await db('loyalty_rules').where('id', id).update({ is_active: false });

    await db('audit_logs').insert({
      action: 'RULE_DEACTIVATED',
      entity_type: 'loyalty_rule',
      entity_id: id,
      old_values: JSON.stringify({ isActive: true }),
      new_values: JSON.stringify({ isActive: false }),
    });

    log.info('Rule deactivated', { ruleId: id });
  }
}
