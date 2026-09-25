import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { RuleService } from '../services/RuleService';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { uuidSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(authorizeAdmin('reviewer', 'manager', 'master_admin'));

const ruleSchema = z.object({
  name: z.string().min(1).max(255),
  rules: z.object({
    currencyThreshold: z.number().positive(),
    pointsPerThreshold: z.number().positive(),
    minimumPurchaseAmount: z.number().min(0),
    eligibleCategories: z.array(z.string()).default([]),
    excludedCategories: z.array(z.string()).default([]),
    maxPointsPerClaim: z.number().min(0),
    pointExpiryDays: z.number().nullable(),
    redemptionConversion: z.number().positive(),
    minimumRedemptionPoints: z.number().min(0),
    maxRedemptionPercentage: z.number().min(0).max(100),
    maxFixedDiscount: z.number().min(0),
    earnOnPointsPayment: z.boolean(),
    claimSubmissionWindowDays: z.number().positive(),
  }),
  effectiveFrom: z.string().transform((s) => new Date(s)),
  effectiveTo: z.string().optional().transform((s) => (s ? new Date(s) : undefined)),
});

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await RuleService.getRules();
    res.json({ rules });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rule = await RuleService.getRuleById(uuidSchema.parse(req.params.id));
    res.json({ rule });
  } catch (error) {
    next(error);
  }
});

router.post('/', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ruleSchema.parse(req.body);
    const rule = await RuleService.createRule(input, req.user!.id, req.requestId);
    res.status(201).json({ message: 'Rule created', rule });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ruleSchema.partial().parse(req.body);
    const rule = await RuleService.updateRule(uuidSchema.parse(req.params.id), input, req.requestId);
    res.json({ message: 'Rule updated', rule });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/activate', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await RuleService.activateRule(uuidSchema.parse(req.params.id), req.requestId);
    res.json({ message: 'Rule activated' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/deactivate', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await RuleService.deactivateRule(uuidSchema.parse(req.params.id), req.requestId);
    res.json({ message: 'Rule deactivated' });
  } catch (error) {
    next(error);
  }
});

export default router;
