import { describe, expect, it } from 'vitest';

import {
  dropsToXrpDecimalString,
  isValidXrpAddress,
  normalizeXrpAddress,
  rippleTimeToUnix,
  unixToRippleTime,
  xrpToDrops,
} from '../utils.js';

describe('XRP Utils', () => {
  describe('normalizeXrpAddress', () => {
    it('should trim whitespace from addresses', () => {
      expect(normalizeXrpAddress('  rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh  ')).toBe('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh');
    });

    it('should preserve case sensitivity', () => {
      expect(normalizeXrpAddress('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh')).toBe('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh');
    });
  });

  describe('isValidXrpAddress', () => {
    it('should validate correct XRP addresses', () => {
      expect(isValidXrpAddress('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh')).toBe(true);
      expect(isValidXrpAddress('r9g7rqJGKLvDPy3vpT98KUcjc6gtBamNsq')).toBe(true);
      expect(isValidXrpAddress('r4RR9vkVpUycFtSog3qaBWPd3sCV457iGw')).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(isValidXrpAddress('1BitcoinAddress')).toBe(false);
      expect(isValidXrpAddress('0xEthereumAddress')).toBe(false);
      expect(isValidXrpAddress('invalid')).toBe(false);
      expect(isValidXrpAddress('r')).toBe(false);
      expect(isValidXrpAddress('')).toBe(false);
    });

    it('should reject addresses with invalid characters', () => {
      expect(isValidXrpAddress('r0000000000000000000000000')).toBe(false); // '0' not in base58
      expect(isValidXrpAddress('rOOOOOOOOOOOOOOOOOOOOOOOOO')).toBe(false); // 'O' not in base58
      expect(isValidXrpAddress('rIIIIIIIIIIIIIIIIIIIIIIII')).toBe(false); // 'I' not in base58
      expect(isValidXrpAddress('rlllllllllllllllllllllllll')).toBe(false); // 'l' not in base58
    });
  });

  describe('dropsToXrpDecimalString', () => {
    it('should convert drops to XRP correctly', () => {
      expect(dropsToXrpDecimalString('1000000')).toBe('1');
      expect(dropsToXrpDecimalString('500000')).toBe('0.5');
      expect(dropsToXrpDecimalString('1')).toBe('0.000001');
      expect(dropsToXrpDecimalString('0')).toBe('0');
    });

    it('should handle large balances without precision loss', () => {
      // 100 billion XRP (max supply)
      expect(dropsToXrpDecimalString('100000000000000000')).toBe('100000000000');
      // Test precision with large number
      expect(dropsToXrpDecimalString('123456789012345')).toBe('123456789.012345');
    });

    it('should handle number inputs', () => {
      expect(dropsToXrpDecimalString(1000000)).toBe('1');
      expect(dropsToXrpDecimalString(500000)).toBe('0.5');
    });

    it('should maintain precision for all 6 decimal places', () => {
      expect(dropsToXrpDecimalString('1234567')).toBe('1.234567');
      expect(dropsToXrpDecimalString('123456')).toBe('0.123456');
      expect(dropsToXrpDecimalString('12345')).toBe('0.012345');
    });
  });

  describe('xrpToDrops', () => {
    it('should convert XRP to drops correctly', () => {
      expect(xrpToDrops('1')).toBe('1000000');
      expect(xrpToDrops('0.5')).toBe('500000');
      expect(xrpToDrops('0.000001')).toBe('1');
      expect(xrpToDrops('0')).toBe('0');
    });

    it('should handle large amounts without precision loss', () => {
      // 100 billion XRP
      expect(xrpToDrops('100000000000')).toBe('100000000000000000');
      expect(xrpToDrops('123456789.012345')).toBe('123456789012345');
    });

    it('should handle number inputs', () => {
      expect(xrpToDrops(1)).toBe('1000000');
      expect(xrpToDrops(0.5)).toBe('500000');
    });

    it('should truncate beyond 6 decimal places', () => {
      // XRP only supports 6 decimal places
      expect(xrpToDrops('1.0000001')).toBe('1000000'); // Truncates the extra decimal
      expect(xrpToDrops('1.123456789')).toBe('1123456'); // Truncates beyond 6 decimals
    });

    it('should roundtrip correctly', () => {
      const testValues = ['1', '0.5', '123.456789', '0.000001', '100000000'];
      for (const xrp of testValues) {
        const drops = xrpToDrops(xrp);
        const backToXrp = dropsToXrpDecimalString(drops);
        // Truncate to 6 decimals for comparison
        const truncated = parseFloat(xrp)
          .toFixed(6)
          .replace(/\.?0+$/, '');
        expect(backToXrp).toBe(truncated);
      }
    });
  });

  describe('rippleTimeToUnix', () => {
    it('should convert Ripple epoch to Unix timestamp', () => {
      // Ripple epoch (Jan 1, 2000 00:00:00 UTC) should be Unix timestamp 946684800
      expect(rippleTimeToUnix(0)).toBe(946684800);

      // Jan 1, 2020 00:00:00 UTC (631152000 Ripple time)
      expect(rippleTimeToUnix(631152000)).toBe(1577836800);

      // Test with real transaction timestamp from our curl example
      expect(rippleTimeToUnix(822274421)).toBe(1768959221);
    });
  });

  describe('unixToRippleTime', () => {
    it('should convert Unix timestamp to Ripple epoch', () => {
      // Unix timestamp 946684800 should be Ripple epoch 0
      expect(unixToRippleTime(946684800)).toBe(0);

      // Jan 1, 2020 00:00:00 UTC
      expect(unixToRippleTime(1577836800)).toBe(631152000);
    });

    it('should roundtrip correctly', () => {
      const testTimestamps = [0, 631152000, 822274421, 1000000000];
      for (const rippleTime of testTimestamps) {
        const unixTime = rippleTimeToUnix(rippleTime);
        const backToRipple = unixToRippleTime(unixTime);
        expect(backToRipple).toBe(rippleTime);
      }
    });
  });
});
