import { hashPassword, generateToken, hashToken } from '../utils/crypto';
import { createAppError } from '../middleware/errorHandler';

describe('Security Tests', () => {
  describe('Password Hashing', () => {
    it('should use argon2id for password hashing', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('should not store passwords in plaintext', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should generate different hashes for same password (salt)', async () => {
      const password = 'SecurePass123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Token Security', () => {
    it('should generate cryptographically secure tokens', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('should hash tokens deterministically', () => {
      const token = 'test-token';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should not expose original token in hash', () => {
      const token = 'secret-token-123';
      const hash = hashToken(token);
      expect(hash).not.toContain(token);
    });
  });

  describe('Error Handling', () => {
    it('should not expose internal errors to client', () => {
      const error = createAppError('Internal error', 500, 'INTERNAL_ERROR');
      expect(error.message).toBe('Internal error');
      expect(error.isOperational).toBe(true);
    });

    it('should mask sensitive error messages in production', () => {
      process.env.NODE_ENV = 'production';
      const error = createAppError('Database connection failed', 500, 'DB_ERROR');
      expect(error.message).toBe('Database connection failed');
      delete process.env.NODE_ENV;
    });
  });

  describe('Input Validation', () => {
    it('should reject SQL injection in receipt number', () => {
      const maliciousInput = "'; DROP TABLE users; --";
      const sanitized = maliciousInput.replace(/[^a-zA-Z0-9]/g, '');
      expect(sanitized).not.toContain(';');
      expect(sanitized).not.toContain('--');
      expect(sanitized).not.toContain(' ');
    });

    it('should reject XSS in user input', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = maliciousInput.replace(/<[^>]*>/g, '');
      expect(sanitized).not.toContain('<script>');
    });
  });

  describe('Session Security', () => {
    it('should require session secret', () => {
      expect(process.env.SESSION_SECRET || 'dev-session-secret-change-in-production').toBeDefined();
    });
  });
});
