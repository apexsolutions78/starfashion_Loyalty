import { Request, Response, NextFunction } from 'express';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';
import {
  issueCsrfToken,
  tokensMatch,
  originCheck,
  ensureCsrfToken,
  verifyCsrfToken,
} from '../middleware/csrf';
import { authorize, authorizeAdmin, authorizeCustomer, AuthUser } from '../middleware/auth';
import { emailSchema, passwordSchema, amountSchema, mobileSchema } from '../utils/validators';

/* eslint-disable @typescript-eslint/no-explicit-any */

type MockSession = { csrfToken?: string; userId?: string; userRole?: string };

function mockReq(overrides: Record<string, unknown> = {}): any {
  const headers: Record<string, string> = {};
  const base: any = {
    method: 'POST',
    headers,
    body: {},
    session: {} as MockSession,
    get(name: string) {
      return headers[String(name).toLowerCase()];
    },
    ...overrides,
  };
  if (overrides.headers) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides.headers as Record<string, string>)) {
      lower[k.toLowerCase()] = v;
    }
    Object.assign(headers, lower);
    base.headers = headers;
    base.get = (name: string) => headers[String(name).toLowerCase()];
  }
  return base;
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: undefined,
    locals: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe('Security Tests', () => {
  describe('Password Hashing', () => {
    it('uses argon2id for password hashing', async () => {
      const hash = await hashPassword('SecurePass123!');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('does not store passwords in plaintext', async () => {
      const hash = await hashPassword('SecurePass123!');
      expect(hash).not.toBe('SecurePass123!');
      expect(hash.length).toBeGreaterThan(50);
    });

    it('generates different hashes for the same password (salt)', async () => {
      const [hash1, hash2] = await Promise.all([
        hashPassword('SecurePass123!'),
        hashPassword('SecurePass123!'),
      ]);
      expect(hash1).not.toBe(hash2);
    });

    it('verifies correct password and rejects wrong password', async () => {
      const hash = await hashPassword('SecurePass123!');
      await expect(verifyPassword('SecurePass123!', hash)).resolves.toBe(true);
      await expect(verifyPassword('WrongPassword1!', hash)).resolves.toBe(false);
    });
  });

  describe('Token Security', () => {
    it('generates 64-char hex tokens', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('hashes tokens deterministically without echoing the token', () => {
      const token = 'secret-token-123';
      expect(hashToken(token)).toBe(hashToken(token));
      expect(hashToken(token)).not.toContain(token);
    });

    it('produces unique tokens across calls', () => {
      expect(generateToken()).not.toBe(generateToken());
    });
  });

  describe('CSRF Token Middleware', () => {
    it('issues a 64-char hex token onto the session', () => {
      const session: MockSession = {};
      const token = issueCsrfToken(session);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(session.csrfToken).toBe(token);
    });

    it('tokensMatch accepts equal tokens and rejects mismatches/empties', () => {
      expect(tokensMatch('abc', 'abc')).toBe(true);
      expect(tokensMatch('abc', 'abd')).toBe(false);
      expect(tokensMatch('', '')).toBe(false);
      expect(tokensMatch('short', 'much-longer-token')).toBe(false);
    });

    it('ensureCsrfToken creates a token and exposes it on res.locals', () => {
      const req = mockReq({ session: {} });
      const res = mockRes();
      const next = jest.fn();
      ensureCsrfToken(req as Request, res as Response, next);
      expect(req.session.csrfToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.locals.csrfToken).toBe(req.session.csrfToken);
      expect(next).toHaveBeenCalledWith();
    });

    it('ensureCsrfToken is idempotent when a token already exists', () => {
      const req = mockReq({ session: { csrfToken: 'existing-token' } });
      const res = mockRes();
      const next = jest.fn();
      ensureCsrfToken(req as Request, res as Response, next);
      expect(req.session.csrfToken).toBe('existing-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('verifyCsrfToken allows safe methods without a token', () => {
      const req = mockReq({ method: 'GET', session: {} });
      const next = jest.fn();
      verifyCsrfToken(req as Request, mockRes() as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('verifyCsrfToken rejects state-changing requests with no token', () => {
      const req = mockReq({ method: 'POST', session: {} });
      const next = jest.fn();
      verifyCsrfToken(req as Request, mockRes() as Response, next);
      const err = next.mock.calls[0][0] as { statusCode: number; code: string };
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('CSRF_INVALID');
    });

    it('verifyCsrfToken rejects invalid tokens', () => {
      const req = mockReq({
        method: 'POST',
        session: { csrfToken: 'a'.repeat(64) },
        headers: { 'x-csrf-token': 'b'.repeat(64) },
      });
      const next = jest.fn();
      verifyCsrfToken(req as Request, mockRes() as Response, next);
      expect((next.mock.calls[0][0] as { code: string }).code).toBe('CSRF_INVALID');
    });

    it('verifyCsrfToken accepts a valid X-CSRF-Token header', () => {
      const token = 'c'.repeat(64);
      const req = mockReq({
        method: 'POST',
        session: { csrfToken: token },
        headers: { 'x-csrf-token': token },
      });
      const next = jest.fn();
      verifyCsrfToken(req as Request, mockRes() as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('verifyCsrfToken accepts a valid _csrf body field', () => {
      const token = 'd'.repeat(64);
      const req = mockReq({
        method: 'POST',
        session: { csrfToken: token },
        body: { _csrf: token },
      });
      const next = jest.fn();
      verifyCsrfToken(req as Request, mockRes() as Response, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('Origin Check Middleware', () => {
    it('allows safe methods', () => {
      const next = jest.fn();
      originCheck(mockReq({ method: 'GET' }) as Request, mockRes() as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows requests with no Origin header (non-browser clients)', () => {
      const next = jest.fn();
      originCheck(mockReq({ method: 'POST', headers: {} }) as Request, mockRes() as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects a mismatched Origin on state-changing requests', () => {
      const res = mockRes();
      const next = jest.fn();
      originCheck(
        mockReq({ method: 'POST', headers: { origin: 'https://evil.example.com' } }) as Request,
        res as Response,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('CSRF_ORIGIN');
    });

    it('rejects an unparseable Origin', () => {
      const res = mockRes();
      const next = jest.fn();
      originCheck(mockReq({ method: 'POST', headers: { origin: 'not-a-url' } }) as Request, res as Response, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('RBAC Middleware', () => {
    function runAuth(
      mw: (req: Request, res: Response, next: NextFunction) => void,
      user?: Partial<AuthUser>,
    ) {
      const req = mockReq({ user });
      const next = jest.fn();
      mw(req as Request, mockRes() as Response, next);
      return next;
    }

    it('authorize rejects unauthenticated requests', () => {
      const next = runAuth(authorize('customer'));
      expect((next.mock.calls[0][0] as { code: string }).code).toBe('AUTH_REQUIRED');
    });

    it('authorize rejects users without the required role', () => {
      const next = runAuth(authorize('master_admin'), {
        id: 'u1',
        email: 'a@b.c',
        role: 'customer',
      });
      expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(403);
      expect((next.mock.calls[0][0] as { code: string }).code).toBe('FORBIDDEN');
    });

    it('authorize allows users with the required role', () => {
      const next = runAuth(authorize('customer', 'master_admin'), {
        id: 'u1',
        email: 'a@b.c',
        role: 'customer',
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('authorizeAdmin rejects customer role', () => {
      const next = runAuth(authorizeAdmin(), {
        id: 'u1',
        email: 'a@b.c',
        role: 'customer',
      });
      expect((next.mock.calls[0][0] as { code: string }).code).toBe('FORBIDDEN');
    });

    it('authorizeAdmin allows master_admin', () => {
      const next = runAuth(authorizeAdmin(), {
        id: 'u1',
        email: 'a@b.c',
        role: 'master_admin',
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('authorizeCustomer rejects admin role', () => {
      const next = runAuth(authorizeCustomer, {
        id: 'u1',
        email: 'a@b.c',
        role: 'master_admin',
      });
      expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(403);
    });
  });

  describe('Error Handling', () => {
    it('creates operational AppError with status and code', () => {
      const error = createAppError('Not found', 404, 'NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.isOperational).toBe(true);
    });

    it('is an Error instance with operational flags', () => {
      const error = createAppError('Safe message', 400, 'BAD_REQUEST');
      expect(error).toBeInstanceOf(Error);
      expect(Object.keys(error)).toEqual(
        expect.arrayContaining(['statusCode', 'code', 'isOperational']),
      );
    });
  });

  describe('Input Validation (real schemas)', () => {
    it('rejects non-email strings via emailSchema', () => {
      for (const bad of [
        'not-an-email',
        'a@b',
        '<script>x</script>',
        "'; DROP TABLE users; --",
        'a@b.c ',
      ]) {
        expect(emailSchema.safeParse(bad).success).toBe(false);
      }
    });

    it('accepts a normal email', () => {
      expect(emailSchema.safeParse('user@example.com').success).toBe(true);
    });

    it('rejects weak passwords via passwordSchema', () => {
      for (const bad of [
        'short1A',
        'alllowercase1',
        'ALLUPPERCASE1',
        'NoDigitsHere!',
        'Password',
      ]) {
        expect(passwordSchema.safeParse(bad).success).toBe(false);
      }
    });

    it('accepts a strong password', () => {
      expect(passwordSchema.safeParse('SecurePass123!').success).toBe(true);
    });

    it('rejects SQL-looking and non-numeric amounts', () => {
      for (const bad of ['1 OR 1=1', '-5', 'abc', '; DROP TABLE points_ledger; --']) {
        expect(amountSchema.safeParse(bad).success).toBe(false);
      }
      expect(amountSchema.safeParse('10.99').success).toBe(true);
    });

    it('rejects invalid mobile numbers', () => {
      for (const bad of ['abc', '123', '+92!', '']) {
        expect(mobileSchema.safeParse(bad).success).toBe(false);
      }
      expect(mobileSchema.safeParse('+923001234567').success).toBe(true);
    });
  });
});
