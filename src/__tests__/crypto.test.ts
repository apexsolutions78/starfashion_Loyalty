import { hashPassword, verifyPassword, generateToken, hashToken, generateOTP } from '../utils/crypto';

describe('Crypto Utils', () => {
  describe('Password Hashing', () => {
    it('should hash a password', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should verify a correct password', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const password = 'SecurePass123!';
      const hash = await hashPassword(password);
      const result = await verifyPassword('WrongPassword!', hash);
      expect(result).toBe(false);
    });

    it('should generate different hashes for the same password', async () => {
      const password = 'SecurePass123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Token Generation', () => {
    it('should generate a 64-character hex token', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('Token Hashing', () => {
    it('should hash a token deterministically', () => {
      const token = 'abc123';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should produce a 64-character SHA-256 hash', () => {
      const token = 'test-token';
      const hash = hashToken(token);
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  describe('OTP Generation', () => {
    it('should generate a 6-digit OTP by default', () => {
      const otp = generateOTP();
      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should generate OTP of specified length', () => {
      const otp = generateOTP(4);
      expect(otp).toHaveLength(4);
      expect(/^\d{4}$/.test(otp)).toBe(true);
    });

    it('should generate unique OTPs', () => {
      const otps = new Set<string>();
      for (let i = 0; i < 100; i++) {
        otps.add(generateOTP());
      }
      expect(otps.size).toBeGreaterThan(90);
    });
  });
});
