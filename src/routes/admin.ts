import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminService } from '../services/AdminService';
import { ReportsService } from '../services/ReportsService';
import { ReviewService } from '../services/ReviewService';
import { PointsEngineService } from '../services/PointsEngineService';
import { ArticleCategoryService } from '../services/ArticleCategoryService';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { db } from '../config/database';
import { passwordSchema, uuidSchema } from '../utils/validators';
import { AuthService } from '../services/AuthService';

const router = Router();

const createAdminSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  mobile: z.string().min(10).max(20),
  password: passwordSchema,
  fullName: z.string().min(2).max(255),
  role: z.enum(['reviewer', 'manager', 'master_admin']),
  department: z.string().max(100).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(['reviewer', 'manager', 'master_admin']),
});

const reverseClaimSchema = z.object({
  reason: z.string().min(1).max(500),
});

const adjustmentSchema = z.object({
  customerId: z.string().min(1).max(36),
  points: z.number().int(),
  reason: z.string().min(1).max(500),
  idempotencyKey: z.string().min(8).max(255).optional(),
});

const articleCategorySchema = z.object({
  category: z.string().min(1).max(100),
  articlePrefix: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updateArticleCategorySchema = articleCategorySchema.partial();

const tierSchema = z.object({
  tier: z.string().min(1).max(50),
});

const resetCustomerPasswordSchema = z.object({
  newPassword: passwordSchema,
});

router.use(authenticate);
router.use(authorizeAdmin('reviewer', 'manager', 'master_admin'));

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await ReportsService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

router.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const logs = await db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', 'users.id')
      .select(
        'audit_logs.action',
        'audit_logs.entity_type',
        'audit_logs.entity_id',
        'audit_logs.created_at',
        'users.email as actorEmail',
        'users.role as actorRole',
      )
      .orderBy('audit_logs.created_at', 'desc')
      .limit(limit);
    res.json({ activity: logs });
  } catch (error) {
    next(error);
  }
});

router.get('/customers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const search = (req.query.search as string | undefined)?.trim();

    let query = db('users')
      .leftJoin('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .where('users.role', 'customer')
      .select(
        'users.id',
        'users.email',
        'users.mobile',
        'users.status',
        'users.email_verified',
        'users.mobile_verified',
        'users.created_at',
        'customer_profiles.full_name',
        'customer_profiles.tier',
        db.raw(
          '(SELECT COALESCE(SUM(points), 0) FROM points_ledger WHERE customer_id = users.id) as totalPoints',
        ),
        db.raw('(SELECT COUNT(*) FROM receipt_claims WHERE customer_id = users.id) as claimCount'),
        db.raw(
          `(SELECT COUNT(*) FROM receipt_claims WHERE customer_id = users.id AND status = 'APPROVED') as approvedClaims`,
        ),
      );

    if (search) {
      const q = `%${search.toLowerCase()}%`;
      query = query.where(function () {
        this.whereRaw('LOWER(users.email) LIKE ?', [q])
          .orWhereRaw('LOWER(COALESCE(customer_profiles.full_name, ?)) LIKE ?', ['', q])
          .orWhereRaw('LOWER(users.mobile) LIKE ?', [q]);
      });
    }

    const [countRow] = await query.clone().clearSelect().count('* as total');
    const customers = await query.orderBy('users.created_at', 'desc').limit(limit).offset(offset);

    res.json({
      customers: customers.map((c) => ({
        ...c,
        totalPoints: Number(c.totalPoints || 0),
        claimCount: Number(c.claimCount || 0),
        approvedClaims: Number(c.approvedClaims || 0),
      })),
      total: Number(countRow?.total || 0),
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const type = req.query.type as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const search = (req.query.search as string | undefined)?.trim();

    let query = db('points_ledger')
      .leftJoin('users', 'points_ledger.customer_id', 'users.id')
      .leftJoin('customer_profiles', 'users.id', 'customer_profiles.user_id')
      .select(
        'points_ledger.id',
        'points_ledger.customer_id',
        'points_ledger.claim_id',
        'points_ledger.voucher_id',
        'points_ledger.type',
        'points_ledger.points',
        'points_ledger.reason',
        'points_ledger.reversal_reference',
        'points_ledger.created_at',
        'users.email as customerEmail',
        'customer_profiles.full_name as customerName',
      );

    if (type) query = query.where('points_ledger.type', type);
    if (customerId) query = query.where('points_ledger.customer_id', customerId);
    if (search) {
      const q = `%${search.toLowerCase()}%`;
      query = query.where(function () {
        this.whereRaw('LOWER(COALESCE(customer_profiles.full_name, ?)) LIKE ?', ['', q])
          .orWhereRaw('LOWER(COALESCE(users.email, ?)) LIKE ?', ['', q]);
      });
    }

    const [countRow] = await query.clone().clearSelect().count('* as total');
    const entries = await query.orderBy('points_ledger.created_at', 'desc').limit(limit).offset(offset);

    res.json({
      entries,
      total: Number(countRow?.total || 0),
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/claims/:id/reverse',
  authorizeAdmin('manager', 'master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claimId = uuidSchema.parse(req.params.id);
      const { reason } = reverseClaimSchema.parse(req.body);
      const result = await ReviewService.reverseClaim(claimId, req.user!.id, reason, req.requestId);
      res.json({ message: 'Claim reversed', ...result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/adjustments',
  authorizeAdmin('manager', 'master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = adjustmentSchema.parse(req.body);
      const entryId = await PointsEngineService.applyManualAdjustment(
        input.customerId,
        input.points,
        input.reason,
        req.user!.id,
        req.requestId,
        input.idempotencyKey,
      );
      res.status(201).json({ message: 'Adjustment applied', entryId });
    } catch (error) {
      next(error);
    }
  },
);

router.get('/article-categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await ArticleCategoryService.list();
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/article-categories',
  authorizeAdmin('master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = articleCategorySchema.parse(req.body);
      const category = await ArticleCategoryService.create(input, req.user!.id, req.requestId);
      res.status(201).json({ message: 'Article category created', category });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/article-categories/:id',
  authorizeAdmin('master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidSchema.parse(req.params.id);
      const input = updateArticleCategorySchema.parse(req.body);
      const category = await ArticleCategoryService.update(id, input, req.requestId);
      res.json({ message: 'Article category updated', category });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/article-categories/:id',
  authorizeAdmin('master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidSchema.parse(req.params.id);
      await ArticleCategoryService.remove(id, req.requestId);
      res.json({ message: 'Article category deleted' });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/customers/:id/tier',
  authorizeAdmin('manager', 'master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = uuidSchema.parse(req.params.id);
      const { tier } = tierSchema.parse(req.body);
      await ArticleCategoryService.setCustomerTier(customerId, tier, req.user!.id, req.requestId);
      res.json({ message: 'Customer tier updated' });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/customers/:id/reset-password',
  authorizeAdmin('manager', 'master_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { newPassword } = resetCustomerPasswordSchema.parse(req.body);
      await AuthService.adminResetPassword(
        uuidSchema.parse(req.params.id),
        newPassword,
        req.user!.id,
        req.requestId,
        { ip: req.ip, userAgent: req.get('user-agent') },
      );
      res.json({
        message: 'Password reset. The customer has been signed out of every device.',
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post('/admins', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAdminSchema.parse(req.body);
    const admin = await AdminService.createAdmin(input, req.user!.id, req.requestId);
    res.status(201).json({ message: 'Admin created successfully', admin });
  } catch (error) {
    next(error);
  }
});

router.get('/admins', authorizeAdmin('master_admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await AdminService.getAdmins();
    res.json({ admins });
  } catch (error) {
    next(error);
  }
});

router.patch('/admins/:id/role', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { role } = updateRoleSchema.parse(req.body);
    await AdminService.updateAdminRole(id, role, req.requestId);
    res.json({ message: 'Admin role updated' });
  } catch (error) {
    next(error);
  }
});

router.post('/admins/:id/suspend', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    await AdminService.suspendAdmin(id, req.requestId);
    res.json({ message: 'Admin suspended' });
  } catch (error) {
    next(error);
  }
});

router.post('/admins/:id/activate', authorizeAdmin('master_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidSchema.parse(req.params.id);
    await AdminService.activateAdmin(id, req.requestId);
    res.json({ message: 'Admin activated' });
  } catch (error) {
    next(error);
  }
});

router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      userId: req.query.userId as string,
      entityType: req.query.entityType as string,
      entityId: req.query.entityId as string,
      action: req.query.action as string,
      search: (req.query.search as string | undefined)?.trim(),
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };
    const result = await AdminService.getAuditLogs(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
