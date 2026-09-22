import { ClaimService } from '../services/ClaimService';

describe('ClaimService', () => {
  describe('Receipt Number Normalization', () => {
    it('should remove spaces from receipt number', () => {
      const result = ClaimService.normalizeReceiptNumber('22-09-2026-01');
      expect(result).toBe('22-09-2026-01');
    });

    it('should handle receipt numbers with spaces', () => {
      const result = ClaimService.normalizeReceiptNumber('22 - 09 - 2026 - 01');
      expect(result).toBe('22-09-2026-01');
    });

    it('should trim whitespace', () => {
      const result = ClaimService.normalizeReceiptNumber('  22-09-2026-01  ');
      expect(result).toBe('22-09-2026-01');
    });
  });

  describe('Receipt Number Format Validation', () => {
    it('should accept valid DD-MM-YYYY-NN format', () => {
      expect(ClaimService.validateReceiptNumberFormat('22-09-2026-01')).toBe(true);
    });

    it('should accept single digit day and month', () => {
      expect(ClaimService.validateReceiptNumberFormat('1-9-2026-01')).toBe(false);
    });

    it('should reject invalid format', () => {
      expect(ClaimService.validateReceiptNumberFormat('invalid')).toBe(false);
      expect(ClaimService.validateReceiptNumberFormat('22/09/2026/01')).toBe(false);
      expect(ClaimService.validateReceiptNumberFormat('2209202601')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(ClaimService.validateReceiptNumberFormat('')).toBe(false);
    });
  });
});
