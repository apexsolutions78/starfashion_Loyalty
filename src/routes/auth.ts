import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/AuthService';
import { authenticate, authorizeCustomer } from '../middleware/auth';
import { issueCsrfToken } from '../middleware/csrf';
import { env } from '../config';
import { passwordSchema } from '../utils/validators';
import { AuthContext } from '../services/AuthService';

const router = Router();

/** Audit metadata for password flows: who from, from where, on which session. */
const authContext = (req: Request): AuthContext => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  sessionId: req.sessionID,
});

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please wait and try again.' },
    });
  },
});

const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  mobile: z.string().min(10).max(20).regex(/^\+?[0-9\s\-()]+$/),
  password: passwordSchema,
  fullName: z.string().min(2).max(255),
  marketingConsent: z.boolean().optional().default(false),
  loyaltyConsent: z.boolean().refine((val) => val === true, {
    message: 'You must accept the loyalty program terms',
  }),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

const verifyContactSchema = z.object({
  token: z.string().min(1),
  type: z.enum(['email', 'mobile']),
});

const resendVerificationSchema = z.object({
  type: z.enum(['email', 'mobile']).default('email'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = registerSchema.parse(req.body);
    const result = await AuthService.register(input, req.requestId);
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }
      req.session.userId = result.user.id;
      req.session.userRole = result.user.role;
      const csrfToken = issueCsrfToken(req.session);
      res.status(201).json({
        message: 'Registration successful. Please verify your email and mobile.',
        user: result.user,
        csrfToken,
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-contact', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, type } = verifyContactSchema.parse(req.body);
    const userId = req.session.userId;
    if (userId) {
      await AuthService.verifyContact(userId, token, type, req.requestId);
    } else {
      await AuthService.verifyContactByToken(token, type, req.requestId);
    }
    res.json({ message: `${type} verified successfully` });
  } catch (error) {
    next(error);
  }
});

router.post('/resend-verification', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = resendVerificationSchema.parse(req.body ?? {});
    await AuthService.resendVerification(req.user!.id, type, req.requestId);
    res.json({
      message:
        env.NODE_ENV !== 'production'
          ? `Verification ${type} re-sent. In development the token is printed in the server console and logs/combined.log.`
          : `Verification ${type} has been sent.`,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await AuthService.login(input, req.requestId);
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }
      req.session.userId = result.user.id;
      req.session.userRole = result.user.role;
      const csrfToken = issueCsrfToken(req.session);
      res.json({ message: 'Login successful', user: result.user, csrfToken });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await AuthService.logout(req.user!.id, req.requestId);
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully' });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await AuthService.forgotPassword(email, req.requestId);
    res.json({ message: 'If an account exists with this email, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    await AuthService.resetPassword(token, newPassword, req.requestId, authContext(req));
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await AuthService.changePassword(
      req.user!.id,
      currentPassword,
      newPassword,
      req.requestId,
      authContext(req),
    );
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await AuthService.getProfile(req.user!.id);
    res.json({ user: profile });
  } catch (error) {
    next(error);
  }
});

router.patch('/me', authenticate, authorizeCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z
      .object({
        fullName: z.string().min(2).max(255).optional(),
        marketingConsent: z.boolean().optional(),
      })
      .parse(req.body);
    const profile = await AuthService.updateProfile(req.user!.id, data, req.requestId);
    res.json({ user: profile });
  } catch (error) {
    next(error);
  }
});

export default router;
