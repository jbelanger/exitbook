import { describe, expect, test } from 'vitest';

import { normalizeEvmAddress } from '../address-utils.js';

describe('normalizeEvmAddress', () => {
  test('accepts valid lowercase EVM address', () => {
    const address = '0x' + 'a'.repeat(40);
    const result = normalizeEvmAddress(address, 'ethereum');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('lowercases checksummed EVM address', () => {
    const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
    const result = normalizeEvmAddress(address, 'ethereum');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address.toLowerCase());
  });

  test('rejects address without 0x prefix', () => {
    const result = normalizeEvmAddress('a'.repeat(40), 'ethereum');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid EVM address format/);
  });

  test('rejects address with wrong length', () => {
    const result = normalizeEvmAddress('0x' + 'a'.repeat(39), 'ethereum');
    expect(result.isErr()).toBe(true);
  });

  test('includes chain name in error message', () => {
    const result = normalizeEvmAddress('invalid', 'polygon');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('polygon');
  });

  test('rejects empty string', () => {
    const result = normalizeEvmAddress('', 'ethereum');
    expect(result.isErr()).toBe(true);
  });
});
