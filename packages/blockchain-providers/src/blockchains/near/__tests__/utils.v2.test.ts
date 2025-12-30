import { describe, it, expect } from 'vitest';

import { extractReceiptFee } from '../utils.v2.js';

describe('extractReceiptFee', () => {
  it('should return fee when tokensBurntYocto is present and non-zero', () => {
    const result = extractReceiptFee({
      tokensBurntYocto: '242800000000000000000',
      predecessorId: 'alice.near',
    });

    expect(result).toEqual({
      amountYocto: '242800000000000000000',
      payer: 'alice.near',
    });
  });

  it('should return undefined when tokensBurntYocto is zero', () => {
    const result = extractReceiptFee({
      tokensBurntYocto: '0',
      predecessorId: 'alice.near',
    });

    expect(result).toBeUndefined();
  });

  it('should return undefined when tokensBurntYocto is missing', () => {
    const result = extractReceiptFee({
      predecessorId: 'alice.near',
    });

    expect(result).toBeUndefined();
  });

  it('should use predecessorId as payer', () => {
    const result = extractReceiptFee({
      tokensBurntYocto: '1000000000000000000',
      predecessorId: 'contract.near',
    });

    expect(result?.payer).toBe('contract.near');
  });

  it('should preserve exact yoctoNEAR amount', () => {
    const amount = '123456789012345678901234567890';
    const result = extractReceiptFee({
      tokensBurntYocto: amount,
      predecessorId: 'alice.near',
    });

    expect(result?.amountYocto).toBe(amount);
  });

  it('should handle implicit account IDs', () => {
    const implicitAccount = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const result = extractReceiptFee({
      tokensBurntYocto: '1000000000000000000',
      predecessorId: implicitAccount,
    });

    expect(result?.payer).toBe(implicitAccount);
  });
});
