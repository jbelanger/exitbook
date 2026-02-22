import { describe, expect, test } from 'vitest';

import { normalizeCardanoAddress } from '../address-utils.js';

describe('normalizeCardanoAddress', () => {
  test('accepts Shelley mainnet payment address', () => {
    const address = 'addr1' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(address);
  });

  test('accepts Shelley mainnet stake address', () => {
    const address = 'stake1' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts Shelley testnet payment address', () => {
    const address = 'addr_test1' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts Shelley testnet stake address', () => {
    const address = 'stake_test1' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts Byron Ae2 address', () => {
    const address = 'Ae2' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts Byron DdzFF address', () => {
    const address = 'DdzFF' + 'a'.repeat(50);
    const result = normalizeCardanoAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts extended public key (128 hex chars)', () => {
    const xpub = 'a'.repeat(128);
    const result = normalizeCardanoAddress(xpub);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(xpub);
  });

  test('rejects unknown address format', () => {
    const result = normalizeCardanoAddress('invalid_address_format');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid Cardano address format/);
  });

  test('rejects empty string', () => {
    const result = normalizeCardanoAddress('');
    expect(result.isErr()).toBe(true);
  });
});
