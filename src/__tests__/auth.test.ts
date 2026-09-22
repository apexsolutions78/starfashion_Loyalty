import { hashPassword, verifyPassword } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';

describe('AuthService', () => {
  describe('Password Hashing', () => {
    it('should hash password with argon2id', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
    });

    it('should verify correct password', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      const result = await verifyPassword('WrongPassword!', hash);
      expect(result).toBe(false);
    });
  });

  describe('AppError', () => {
    it('should create operational error', () => {
      const error = createAppError('Not found', 404, 'NOT_FOUND');
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.isOperational).toBe(true);
    });

    it('should create auth error', () => {
      const error = createAppError('Unauthorized', 401, 'UNAUTHORIZED');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });
});
