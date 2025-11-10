/* eslint-disable unicorn/no-null -- needed for testing */
import { describe, expect, it } from 'vitest';

import { extractMethodId, getTransactionTypeFromFunctionName, normalizeEvmAddress } from './utils.js';

describe('evm/utils', () => {
  describe('normalizeEvmAddress', () => {
    it('should normalize address to lowercase', () => {
      expect(normalizeEvmAddress('0xAbC123')).toBe('0xabc123');
    });

    it('should return undefined for null', () => {
      expect(normalizeEvmAddress(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(normalizeEvmAddress(void 0)).toBeUndefined();
    });

    it('should handle already lowercase addresses', () => {
      expect(normalizeEvmAddress('0xabc123')).toBe('0xabc123');
    });
  });

  describe('extractMethodId', () => {
    it('should extract method ID from input data', () => {
      const result = extractMethodId('0xa9059cbb000000000000000000000000');
      expect(result).toBe('0xa9059cbb');
    });

    it('should handle minimal valid input', () => {
      const result = extractMethodId('0x12345678');
      expect(result).toBe('0x12345678');
    });

    it('should return undefined for input shorter than 10 characters', () => {
      const result = extractMethodId('0x1234567');
      expect(result).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      const result = extractMethodId(null);
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      const result = extractMethodId(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = extractMethodId('');
      expect(result).toBeUndefined();
    });

    it('should extract from long input data', () => {
      const longInput =
        '0xa9059cbb000000000000000000000000abcdef1234567890abcdef1234567890abcdef12000000000000000000000000000000000000000000000000000000000000000a';
      const result = extractMethodId(longInput);
      expect(result).toBe('0xa9059cbb');
    });
  });

  describe('getTransactionTypeFromFunctionName', () => {
    it('should return "contract_call" when function name is provided', () => {
      expect(getTransactionTypeFromFunctionName('transfer')).toBe('contract_call');
    });

    it('should return "contract_call" for any non-empty function name', () => {
      expect(getTransactionTypeFromFunctionName('approve')).toBe('contract_call');
      expect(getTransactionTypeFromFunctionName('swap')).toBe('contract_call');
    });

    it('should return "transfer" when function name is null', () => {
      expect(getTransactionTypeFromFunctionName(null)).toBe('transfer');
    });

    it('should return "transfer" when function name is undefined', () => {
      expect(getTransactionTypeFromFunctionName(undefined)).toBe('transfer');
    });

    it('should return "transfer" for empty string', () => {
      expect(getTransactionTypeFromFunctionName('')).toBe('transfer');
    });
  });
});
