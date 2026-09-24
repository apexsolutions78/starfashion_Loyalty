import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { ClaimService } from '../services/ClaimService';
import { authenticate, authorizeCustomer } from '../middleware/auth';
import { uploadReceipt, handleUploadError } from '../middleware/upload';
import { createAppError } from '../middleware/errorHandler';
import { sanitizeUploadedImage } from '../utils/imageSanitizer';
import { amountSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(authorizeCustomer);

const createClaimSchema = z.object({
  receiptNumber: z.string().min(1).max(100),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  submittedAmount: amountSchema,
  submittedArticles: z.preprocess((val) => {
    if (typeof val === 'string' && val.trim()) {
      try {
        const parsed = JSON.parse(val);
        return parsed;
      } catch {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return val;
  }, z.array(z.string()).optional()),
});

const resubmitClaimSchema = z.object({
  submittedAmount: amountSchema,
  submittedArticles: createClaimSchema.shape.submittedArticles.optional(),
});

function discardUploadedFile(req: Request): void {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => undefined);
  }
}

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  uploadReceipt(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    next();
  });
}, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return next(createAppError('Receipt image is required', 400, 'MISSING_FILE'));
    }

    try {
      await sanitizeUploadedImage(req.file.path, req.file.mimetype);
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }

    let input;
    try {
      input = createClaimSchema.parse(req.body);
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }

    try {
      const claim = await ClaimService.createClaim(
        req.user!.id,
        {
          ...input,
          submittedAmount: Number(input.submittedAmount),
          receiptImagePath: req.file.path,
        },
        req.requestId,
      );

      res.status(201).json({
        message: 'Receipt submitted for review',
        claim: {
          id: claim.id,
          receiptNumber: claim.receiptNumber,
          status: claim.status,
          submittedAmount: claim.submittedAmount,
          purchaseDate: claim.purchaseDate,
          createdAt: claim.createdAt,
        },
      });
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      status: req.query.status as string | undefined,
    };

    const result = await ClaimService.getCustomerClaims(req.user!.id, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      unreadOnly: req.query.unreadOnly === 'true',
    };
    const result = await ClaimService.getNotifications(req.user!.id, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/notifications/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notificationId = req.params.id as string;
    await ClaimService.markNotificationRead(notificationId, req.user!.id);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ClaimService.markAllNotificationsRead(req.user!.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimId = req.params.id as string;
    const claim = await ClaimService.getClaimById(claimId, req.user!.id);
    res.json({ claim });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/resubmit', (req: Request, res: Response, next: NextFunction) => {
  uploadReceipt(req, res, (err) => {
    if (err) {
      return handleUploadError(err, req, res, next);
    }
    next();
  });
}, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      discardUploadedFile(req);
      return next(createAppError('Receipt image is required', 400, 'MISSING_FILE'));
    }

    try {
      await sanitizeUploadedImage(req.file.path, req.file.mimetype);
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }

    let input;
    try {
      input = resubmitClaimSchema.parse(req.body);
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }

    const claimId = req.params.id as string;
    try {
      const claim = await ClaimService.resubmitClaim(
        claimId,
        req.user!.id,
        {
          receiptImagePath: req.file.path,
          submittedAmount: Number(input.submittedAmount),
          submittedArticles: input.submittedArticles,
        },
        req.requestId,
      );

      res.json({
        message: 'Claim resubmitted for review',
        claim: {
          id: claim.id,
          status: claim.status,
        },
      });
    } catch (error) {
      discardUploadedFile(req);
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

export default router;
