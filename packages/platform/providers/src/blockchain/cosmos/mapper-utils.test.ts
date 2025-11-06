import { describe, expect, it } from 'vitest';

import { formatDenom, generatePeggyId, isTransactionRelevant } from './mapper-utils.js';

describe('mapper-utils', () => {
  describe('isTransactionRelevant', () => {
    const relevantAddress = 'inj1xyz';

    it('should return true when address is recipient with positive amount', () => {
      const result = isTransactionRelevant('inj1abc', 'inj1xyz', relevantAddress, '1.5');
      expect(result).toBe(true);
    });

    it('should return true when address is sender with positive amount', () => {
      const result = isTransactionRelevant('inj1xyz', 'inj1abc', relevantAddress, '1.5');
      expect(result).toBe(true);
    });

    it('should return false when address is not involved', () => {
      const result = isTransactionRelevant('inj1abc', 'inj1def', relevantAddress, '1.5');
      expect(result).toBe(false);
    });

    it('should return false when amount is zero', () => {
      const result = isTransactionRelevant('inj1xyz', 'inj1abc', relevantAddress, '0');
      expect(result).toBe(false);
    });

    it('should return false when amount is negative', () => {
      const result = isTransactionRelevant('inj1xyz', 'inj1abc', relevantAddress, '-1.5');
      expect(result).toBe(false);
    });

    it('should return false when recipient matches but amount is zero', () => {
      const result = isTransactionRelevant('inj1abc', 'inj1xyz', relevantAddress, '0');
      expect(result).toBe(false);
    });

    it('should handle very small positive amounts', () => {
      const result = isTransactionRelevant('inj1xyz', 'inj1abc', relevantAddress, '0.000000001');
      expect(result).toBe(true);
    });

    it('should handle very large amounts', () => {
      const result = isTransactionRelevant('inj1xyz', 'inj1abc', relevantAddress, '1000000000');
      expect(result).toBe(true);
    });

    it('should return false when from and to are empty strings', () => {
      const result = isTransactionRelevant('', '', relevantAddress, '1.5');
      expect(result).toBe(false);
    });
  });

  describe('formatDenom', () => {
    it('should format "inj" to "INJ"', () => {
      expect(formatDenom('inj')).toBe('INJ');
    });

    it('should format "uinj" to "INJ"', () => {
      expect(formatDenom('uinj')).toBe('INJ');
    });

    it('should uppercase other denoms', () => {
      expect(formatDenom('usdc')).toBe('USDC');
      expect(formatDenom('atom')).toBe('ATOM');
      expect(formatDenom('osmo')).toBe('OSMO');
    });

    it('should handle undefined by returning default "INJ"', () => {
      expect(formatDenom(void 0)).toBe('INJ');
    });

    it('should handle empty string', () => {
      expect(formatDenom('')).toBe('INJ');
    });

    it('should handle already uppercase denoms', () => {
      expect(formatDenom('USDC')).toBe('USDC');
    });

    it('should handle mixed case denoms', () => {
      expect(formatDenom('UsDc')).toBe('USDC');
    });
  });

  describe('generatePeggyId', () => {
    const txHash = '0xabcdef123456';

    it('should use event nonce when available', () => {
      const result = generatePeggyId('12345', [1, 2], txHash);
      expect(result).toBe('peggy-deposit-12345');
    });

    it('should use first claim id when event nonce is undefined', () => {
      const result = generatePeggyId(undefined, [67, 89], txHash);
      expect(result).toBe('peggy-deposit-67');
    });

    it('should use transaction hash when both event nonce and claim id are unavailable', () => {
      const result = generatePeggyId(undefined, [], txHash);
      expect(result).toBe(txHash);
    });

    it('should use transaction hash when claim id is undefined', () => {
      const result = generatePeggyId(undefined, undefined, txHash);
      expect(result).toBe(txHash);
    });

    it('should prefer event nonce over claim id', () => {
      const result = generatePeggyId('999', [123], txHash);
      expect(result).toBe('peggy-deposit-999');
    });

    it('should handle string event nonces', () => {
      const result = generatePeggyId('event-123-abc', [1], txHash);
      expect(result).toBe('peggy-deposit-event-123-abc');
    });

    it('should handle large claim id numbers', () => {
      const result = generatePeggyId(undefined, [999999999], txHash);
      expect(result).toBe('peggy-deposit-999999999');
    });

    it('should handle empty claim id array', () => {
      const result = generatePeggyId(undefined, [], txHash);
      expect(result).toBe(txHash);
    });
  });
});
