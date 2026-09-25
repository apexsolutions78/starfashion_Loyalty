import { Router, Request, Response } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorizeAdmin('reviewer', 'manager', 'master_admin'));

router.get('/', (req: Request, res: Response) => {
  res.render('admin/dashboard', { title: 'Admin Dashboard', active: 'dashboard', layout: 'layout' });
});

router.get('/review', (req: Request, res: Response) => {
  res.render('admin/review-queue', { title: 'Review Queue', active: 'review', layout: 'layout' });
});

router.get('/review/:id', (req: Request, res: Response) => {
  res.render('admin/review-detail', { title: 'Review Claim', active: 'review', claimId: req.params.id, layout: 'layout' });
});

router.get('/users', (req: Request, res: Response) => {
  res.render('admin/users', { title: 'Users', active: 'users', layout: 'layout' });
});

router.get('/customers', (req: Request, res: Response) => {
  res.render('admin/customers', { title: 'Customers', active: 'customers', layout: 'layout' });
});

router.get('/rules', (req: Request, res: Response) => {
  res.render('admin/rules', { title: 'Loyalty Rules', active: 'rules', layout: 'layout' });
});

router.get('/offers', (req: Request, res: Response) => {
  res.render('admin/offers', { title: 'Offers', active: 'offers', layout: 'layout' });
});

router.get('/ledger', (req: Request, res: Response) => {
  res.render('admin/ledger', { title: 'Points Ledger', active: 'ledger', layout: 'layout' });
});

router.get('/audit', (req: Request, res: Response) => {
  res.render('admin/audit', { title: 'Audit Logs', active: 'audit', layout: 'layout' });
});

router.get('/profile', (req: Request, res: Response) => {
  res.render('admin/profile', { title: 'My Profile', active: 'profile', layout: 'layout' });
});

export default router;
