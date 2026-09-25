import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { RedemptionService } from '../services/RedemptionService';
import { authenticate, authorizeCustomer, authorizeAdmin } from '../middleware/auth';
import { uuidSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);

const quoteSchema = z.object({
  pointsToRedeem: z.number().positive(),
});

const createVoucherSchema = z.object({
  pointsToRedeem: z.number().positive(),
});

const useVoucherSchema = z.object({
  voucherCode: z.string().min(1),
});

router.post('/quote', authorizeCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pointsToRedeem } = quoteSchema.parse(req.body);
    const quote = await RedemptionService.getRedemptionQuote(req.user!.id, pointsToRedeem);
    res.json({ quote });
  } catch (error) {
    next(error);
  }
});

router.post('/', authorizeCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pointsToRedeem } = createVoucherSchema.parse(req.body);
    const voucher = await RedemptionService.createVoucher(req.user!.id, pointsToRedeem, req.requestId);
    res.status(201).json({
      message: 'Voucher created successfully',
      voucher: {
        id: voucher.id,
        voucherCode: voucher.voucherCode,
        pointsRedeemed: voucher.pointsRedeemed,
        discountAmount: voucher.discountAmount,
        expiresAt: voucher.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', authorizeCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      status: req.query.status as string | undefined,
    };
    const result = await RedemptionService.getCustomerVouchers(req.user!.id, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/use', authorizeAdmin('reviewer', 'manager', 'master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { voucherCode } = useVoucherSchema.parse(req.body);
    await RedemptionService.useVoucher(voucherCode, req.user!.id, req.requestId);
    res.json({ message: 'Voucher marked as used' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', authorizeCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const voucherId = uuidSchema.parse(req.params.id);
    await RedemptionService.cancelVoucher(voucherId, req.user!.id, req.requestId);
    res.json({ message: 'Voucher cancelled and points restored' });
  } catch (error) {
    next(error);
  }
});

export default router;
