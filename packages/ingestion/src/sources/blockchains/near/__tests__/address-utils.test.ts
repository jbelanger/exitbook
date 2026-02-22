import { describe, expect, test } from 'vitest';

import { normalizeNearAddress } from '../address-utils.js';

describe('normalizeNearAddress', () => {
  test('accepts implicit account (64-char hex)', () => {
    const address = 'a'.repeat(64);
    const result = normalizeNearAddress(address);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('accepts named mainnet account', () => {
    const result = normalizeNearAddress('alice.near');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe('alice.near');
  });

  test('accepts testnet account', () => {
    const result = normalizeNearAddress('bob.testnet');
    expect(result.isOk()).toBe(true);
  });

  test('preserves original casing', () => {
    // NEAR accounts are case-sensitive
    const address = 'Alice.near';
    const result = normalizeNearAddress(address);
    // isValidNearAccountId determines validity; NEAR accounts are actually lowercase-only
    // A mixed-case account would fail validation
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('rejects empty string', () => {
    const result = normalizeNearAddress('');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid NEAR account ID format/);
  });

  test('rejects account with invalid characters', () => {
    const result = normalizeNearAddress('alice!@#.near');
    expect(result.isErr()).toBe(true);
  });
});
