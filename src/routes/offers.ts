import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OfferService } from '../services/OfferService';
import { authenticate, authorizeAdmin, authorizeCustomer } from '../middleware/auth';

const router = Router();

const offerSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  offerType: z.enum(['multiplier', 'fixed_bonus', 'percentage_bonus', 'birthday', 'referral', 'coupon']),
  conditions: z.object({
    minimumPurchaseAmount: z.number().min(0).optional(),
    eligibleArticles: z.array(z.string()).optional(),
    eligibleCategories: z.array(z.string()).optional(),
    eligibleTiers: z.array(z.string()).optional(),
    multiplier: z.number().min(1).optional(),
    bonusPoints: z.number().min(0).optional(),
    bonusPercentage: z.number().min(0).max(1000).optional(),
  }).optional(),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)),
  maxUsesPerCustomer: z.number().min(1).optional(),
  globalMaxUses: z.number().min(1).optional(),
  priority: z.number().min(0).optional(),
  stackable: z.boolean().optional(),
  terms: z.string().optional(),
});

router.get('/active', authenticate, authorizeCustomer, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await OfferService.getActiveOffers();
    res.json({ offers });
  } catch (error) {
    next(error);
  }
});

router.get('/', authenticate, authorizeAdmin('reviewer', 'manager', 'master_admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await OfferService.getOffers(true);
    res.json({ offers });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, authorizeAdmin('reviewer', 'manager', 'master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offer = await OfferService.getOfferById(req.params.id as string);
    res.json({ offer });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = offerSchema.parse(req.body);
    const offer = await OfferService.createOffer(input, req.user!.id, req.requestId);
    res.status(201).json({ message: 'Offer created', offer });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authenticate, authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = offerSchema.partial().parse(req.body);
    const offer = await OfferService.updateOffer(req.params.id as string, input, req.requestId);
    res.json({ message: 'Offer updated', offer });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/activate', authenticate, authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await OfferService.activateOffer(req.params.id as string, req.requestId);
    res.json({ message: 'Offer activated' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/deactivate', authenticate, authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await OfferService.deactivateOffer(req.params.id as string, req.requestId);
    res.json({ message: 'Offer deactivated' });
  } catch (error) {
    next(error);
  }
});

export default router;
