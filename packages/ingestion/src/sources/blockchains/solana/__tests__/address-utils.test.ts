import { describe, expect, test } from 'vitest';

import { normalizeSolanaAddress } from '../address-utils.js';

describe('normalizeSolanaAddress', () => {
  test('accepts valid 44-char base58 address', () => {
    const address = 'So11111111111111111111111111111111111111112';
    const result = normalizeSolanaAddress(address);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('preserves original casing', () => {
    const address = 'DRpbCBMxVnDK7maPGv7LKjbdHRzA5PHG9BFLCvRYnqzV';
    const result = normalizeSolanaAddress(address);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('rejects address with invalid base58 characters (0, O, I, l)', () => {
    const result = normalizeSolanaAddress('0'.repeat(44));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid Solana address format/);
  });

  test('rejects address that is too short', () => {
    const result = normalizeSolanaAddress('abc');
    expect(result.isErr()).toBe(true);
  });

  test('rejects address that is too long', () => {
    const result = normalizeSolanaAddress('a'.repeat(45));
    expect(result.isErr()).toBe(true);
  });

  test('rejects empty string', () => {
    const result = normalizeSolanaAddress('');
    expect(result.isErr()).toBe(true);
  });
});
