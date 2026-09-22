import { emailSchema, mobileSchema, passwordSchema, amountSchema } from '../utils/validators';

describe('Validators', () => {
  describe('Email Schema', () => {
    it('should accept valid emails', () => {
      expect(emailSchema.parse('test@example.com')).toBe('test@example.com');
      expect(emailSchema.parse('USER@DOMAIN.COM')).toBe('user@domain.com');
    });

    it('should reject invalid emails', () => {
      expect(() => emailSchema.parse('')).toThrow();
      expect(() => emailSchema.parse('not-an-email')).toThrow();
      expect(() => emailSchema.parse('@domain.com')).toThrow();
      expect(() => emailSchema.parse('user@')).toThrow();
    });
  });

  describe('Mobile Schema', () => {
    it('should accept valid mobile numbers', () => {
      expect(mobileSchema.parse('+923001234567')).toBe('+923001234567');
      expect(mobileSchema.parse('03001234567')).toBe('03001234567');
      expect(mobileSchema.parse('+92 300 123 4567')).toBe('+923001234567');
    });

    it('should reject invalid mobile numbers', () => {
      expect(() => mobileSchema.parse('')).toThrow();
      expect(() => mobileSchema.parse('123')).toThrow();
      expect(() => mobileSchema.parse('abcdefghij')).toThrow();
    });
  });

  describe('Password Schema', () => {
    it('should accept valid passwords', () => {
      expect(passwordSchema.parse('SecurePass1')).toBeDefined();
      expect(passwordSchema.parse('MyP@ssw0rd')).toBeDefined();
    });

    it('should reject weak passwords', () => {
      expect(() => passwordSchema.parse('')).toThrow();
      expect(() => passwordSchema.parse('short')).toThrow();
      expect(() => passwordSchema.parse('alllowercase1')).toThrow();
      expect(() => passwordSchema.parse('ALLUPPERCASE1')).toThrow();
      expect(() => passwordSchema.parse('NoNumbers!')).toThrow();
    });
  });

  describe('Amount Schema', () => {
    it('should accept valid amounts', () => {
      expect(amountSchema.parse(0.01)).toBe(0.01);
      expect(amountSchema.parse(1000)).toBe(1000);
      expect(amountSchema.parse(99999.99)).toBe(99999.99);
    });

    it('should reject invalid amounts', () => {
      expect(() => amountSchema.parse(0)).toThrow();
      expect(() => amountSchema.parse(-100)).toThrow();
    });
  });
});
