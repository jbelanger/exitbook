import { describe, expect, it } from 'vitest';

import { assertErr, assertOk } from '../../__tests__/test-utils.js';
import { fromBaseUnitsToDecimalString } from '../base-unit-utils.js';

describe('base-unit-utils', () => {
  describe('fromBaseUnitsToDecimalString', () => {
    it('should normalize token amount in smallest units to decimal', () => {
      // USDC (6 decimals): 1000 USDC
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000', 6))).toBe('1000');

      // DAI (18 decimals): 5000 DAI
      expect(assertOk(fromBaseUnitsToDecimalString('5000000000000000000000', 18))).toBe('5000');

      // WBTC (8 decimals): 0.5 BTC
      expect(assertOk(fromBaseUnitsToDecimalString('50000000', 8))).toBe('0.5');
    });

    it('should handle large token amounts (millions)', () => {
      // 2,000,000 USDC in smallest units (6 decimals)
      expect(assertOk(fromBaseUnitsToDecimalString('2000000000000', 6))).toBe('2000000');

      // 10,000,000 SHIB in smallest units (18 decimals)
      expect(assertOk(fromBaseUnitsToDecimalString('10000000000000000000000000', 18))).toBe('10000000');

      // 100,000,000 tokens with 6 decimals
      expect(assertOk(fromBaseUnitsToDecimalString('100000000000000', 6))).toBe('100000000');
    });

    it('should handle very small token amounts', () => {
      // 0.000001 USDC (6 decimals)
      expect(assertOk(fromBaseUnitsToDecimalString('1', 6))).toBe('0.000001');

      // 0.000000000000000001 DAI (18 decimals)
      expect(assertOk(fromBaseUnitsToDecimalString('1', 18))).toBe('0.000000000000000001');
    });

    it('should handle zero amounts', () => {
      expect(assertOk(fromBaseUnitsToDecimalString('0', 6))).toBe('0');
      expect(assertOk(fromBaseUnitsToDecimalString('0', 18))).toBe('0');
      expect(assertOk(fromBaseUnitsToDecimalString(undefined, 6))).toBe('0');
    });

    it('should return as-is when decimals is undefined', () => {
      expect(assertOk(fromBaseUnitsToDecimalString('123.45'))).toBe('123.45');
      expect(assertOk(fromBaseUnitsToDecimalString('1000000'))).toBe('1000000');
    });

    it('should handle edge cases gracefully', () => {
      // Empty string
      expect(assertOk(fromBaseUnitsToDecimalString('', 6))).toBe('0');

      // Null decimals
      expect(assertOk(fromBaseUnitsToDecimalString('1000', undefined as unknown as undefined))).toBe('1000');
    });

    it('should return error for invalid amounts', () => {
      const result = fromBaseUnitsToDecimalString('invalid', 18);
      expect(result.isErr()).toBe(true);
      expect(assertErr(result).message).toContain('Invalid argument');
    });

    it('should normalize native amount in smallest units to decimal', () => {
      // ETH: 1 ETH = 10^18 wei
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000000000000', 18))).toBe('1');

      // BTC: 1 BTC = 10^8 satoshi
      expect(assertOk(fromBaseUnitsToDecimalString('100000000', 8))).toBe('1');

      // SOL: 1 SOL = 10^9 lamports
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000', 9))).toBe('1');
    });

    it('should handle large native amounts', () => {
      // 1000 ETH in wei
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000000000000000', 18))).toBe('1000');

      // 21,000,000 BTC in satoshi (max supply)
      expect(assertOk(fromBaseUnitsToDecimalString('2100000000000000', 8))).toBe('21000000');
    });

    it('should handle very small native amounts', () => {
      // 1 Gwei = 10^9 wei = 0.000000001 ETH
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000', 18))).toBe('0.000000001');

      // 1 satoshi = 0.00000001 BTC
      expect(assertOk(fromBaseUnitsToDecimalString('1', 8))).toBe('0.00000001');
    });

    it('should handle zero amounts', () => {
      expect(assertOk(fromBaseUnitsToDecimalString('0', 18))).toBe('0');
      expect(assertOk(fromBaseUnitsToDecimalString('0', 8))).toBe('0');
      expect(assertOk(fromBaseUnitsToDecimalString(undefined, 18))).toBe('0');
    });

    it('should handle edge cases gracefully', () => {
      // Empty string
      expect(assertOk(fromBaseUnitsToDecimalString('', 18))).toBe('0');
    });

    it('should handle gas fees correctly', () => {
      // Typical ETH gas fee: 0.001 ETH
      expect(assertOk(fromBaseUnitsToDecimalString('1000000000000000', 18))).toBe('0.001');

      // High gas fee: 0.05 ETH
      expect(assertOk(fromBaseUnitsToDecimalString('50000000000000000', 18))).toBe('0.05');
    });

    it('should return error for invalid amounts', () => {
      const result = fromBaseUnitsToDecimalString('invalid', 18);
      expect(result.isErr()).toBe(true);
      expect(assertErr(result).message).toContain('Invalid argument');
    });
  });
});
