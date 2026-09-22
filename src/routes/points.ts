import { Router, Request, Response, NextFunction } from 'express';
import { PointsEngineService } from '../services/PointsEngineService';
import { authenticate, authorizeCustomer } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorizeCustomer);

router.get('/balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const balance = await PointsEngineService.getBalance(req.user!.id);
    res.json({ balance });
  } catch (error) {
    next(error);
  }
});

router.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      type: req.query.type as string | undefined,
    };
    const result = await PointsEngineService.getLedger(req.user!.id, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
