import { Router, Request, Response } from 'express';
import { authenticate, authorizeCustomer } from '../middleware/auth';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.render('auth/login', { title: 'Login', layout: 'layout' });
});

router.get('/login', (req: Request, res: Response) => {
  res.render('auth/login', { title: 'Login', layout: 'layout' });
});

router.get('/register', (req: Request, res: Response) => {
  res.render('auth/register', { title: 'Register', layout: 'layout' });
});

router.get('/forgot-password', (req: Request, res: Response) => {
  res.render('auth/forgot-password', { title: 'Forgot Password', layout: 'layout' });
});

router.get('/dashboard', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/dashboard', { title: 'Dashboard', active: 'dashboard', layout: 'layout' });
});

router.get('/claims', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/claims', { title: 'My Claims', active: 'claims', layout: 'layout' });
});

router.get('/claims/new', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/new-claim', { title: 'Upload Receipt', active: 'claims', layout: 'layout' });
});

router.get('/points', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/points', { title: 'Points', active: 'points', layout: 'layout' });
});

router.get('/redemptions', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/redemptions', { title: 'Redemptions', active: 'redemptions', layout: 'layout' });
});

router.get('/offers', authenticate, authorizeCustomer, (req: Request, res: Response) => {
  res.render('customer/offers', { title: 'Offers', active: 'offers', layout: 'layout' });
});

export default router;
