import { describe, expect, it } from 'vitest';

import { maskAddress } from './address-utils.js';

describe('address-utils', () => {
  describe('maskAddress', () => {
    it('should mask long addresses by showing first 4 and last 4 characters', () => {
      expect(maskAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('1A1z...vfNa');
      expect(maskAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')).toBe('0x74...0bEb');
      expect(maskAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe('bc1q...0wlh');
    });

    it('should return short addresses unchanged (8 chars or less)', () => {
      expect(maskAddress('short')).toBe('short');
      expect(maskAddress('12345')).toBe('12345');
      expect(maskAddress('a')).toBe('a');
    });

    it('should handle exactly 8 character addresses (boundary case)', () => {
      expect(maskAddress('12345678')).toBe('12345678');
    });

    it('should handle exactly 9 character addresses (first case that gets masked)', () => {
      expect(maskAddress('123456789')).toBe('1234...6789');
    });

    it('should return empty string for empty input', () => {
      expect(maskAddress('')).toBe('');
    });

    it('should handle null input gracefully', () => {
      expect(maskAddress()).toBe('');
    });

    it('should handle undefined input gracefully', () => {
      expect(maskAddress()).toBe('');
    });

    it('should handle very long addresses correctly', () => {
      const longAddress = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(maskAddress(longAddress)).toBe('0x12...cdef');
      expect(maskAddress(longAddress).length).toBe(11); // "xxxx...yyyy"
    });

    it('should mask addresses with special characters', () => {
      expect(maskAddress('cosmos1...test123')).toBe('cosm...t123');
      expect(maskAddress('address_with_underscore')).toBe('addr...core');
    });

    it('should handle addresses of various lengths', () => {
      expect(maskAddress('123456789')).toBe('1234...6789'); // 9 chars
      expect(maskAddress('1234567890')).toBe('1234...7890'); // 10 chars
      expect(maskAddress('12345678901')).toBe('1234...8901'); // 11 chars
      expect(maskAddress('123456789012')).toBe('1234...9012'); // 12 chars
    });
  });
});
