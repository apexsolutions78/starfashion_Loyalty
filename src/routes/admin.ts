import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminService } from '../services/AdminService';
import { authenticate, authorizeAdmin } from '../middleware/auth';

const router = Router();

const createAdminSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  mobile: z.string().min(10).max(20),
  password: z
    .string()
    .min(8)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
  fullName: z.string().min(2).max(255),
  role: z.enum(['reviewer', 'manager', 'master_admin']),
  department: z.string().max(100).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(['reviewer', 'manager', 'master_admin']),
});

router.use(authenticate);
router.use(authorizeAdmin('master_admin'));

router.post('/admins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAdminSchema.parse(req.body);
    const admin = await AdminService.createAdmin(input, req.user!.id, req.requestId);
    res.status(201).json({ message: 'Admin created successfully', admin });
  } catch (error) {
    next(error);
  }
});

router.get('/admins', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await AdminService.getAdmins();
    res.json({ admins });
  } catch (error) {
    next(error);
  }
});

router.patch('/admins/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { role } = updateRoleSchema.parse(req.body);
    await AdminService.updateAdminRole(id, role, req.requestId);
    res.json({ message: 'Admin role updated' });
  } catch (error) {
    next(error);
  }
});

router.post('/admins/:id/suspend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await AdminService.suspendAdmin(id, req.requestId);
    res.json({ message: 'Admin suspended' });
  } catch (error) {
    next(error);
  }
});

router.post('/admins/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
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
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };
    const result = await AdminService.getAuditLogs(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
