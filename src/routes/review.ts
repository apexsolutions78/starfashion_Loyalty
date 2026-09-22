import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReviewService } from '../services/ReviewService';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { amountSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(authorizeAdmin('reviewer', 'manager', 'master_admin'));

const approveSchema = z.object({
  approvedAmount: amountSchema,
  eligibleAmount: amountSchema,
  reviewerNotes: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

const requestImageSchema = z.object({
  notes: z.string().min(1).max(500),
});

router.get('/claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      search: req.query.search as string | undefined,
    };
    const result = await ReviewService.getPendingClaims(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/claims/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const claim = await ReviewService.getClaimDetails(claimId);
    const history = await ReviewService.getCustomerHistory(claim.customerId);
    res.json({ claim, customerHistory: history });
  } catch (error) {
    next(error);
  }
});

router.post('/claims/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const decision = approveSchema.parse(req.body);
    await ReviewService.approveClaim(
      claimId,
      req.user!.id,
      {
        approvedAmount: Number(decision.approvedAmount),
        eligibleAmount: Number(decision.eligibleAmount),
        reviewerNotes: decision.reviewerNotes,
      },
      req.requestId,
    );
    res.json({ message: 'Claim approved successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/claims/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const { rejectionReason } = rejectSchema.parse(req.body);
    await ReviewService.rejectClaim(claimId, req.user!.id, rejectionReason, req.requestId);
    res.json({ message: 'Claim rejected' });
  } catch (error) {
    next(error);
  }
});

router.post('/claims/:id/request-image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const { notes } = requestImageSchema.parse(req.body);
    await ReviewService.requestClearerImage(claimId, req.user!.id, notes, req.requestId);
    res.json({ message: 'Clearer image requested' });
  } catch (error) {
    next(error);
  }
});

router.get('/claims/:id/image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const imagePath = await ReviewService.getImagePath(claimId);
    res.sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

export default router;
