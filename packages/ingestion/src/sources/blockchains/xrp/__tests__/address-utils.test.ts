import { describe, expect, test } from 'vitest';

import { normalizeXrpAddress } from '../address-utils.js';

describe('normalizeXrpAddress', () => {
  test('accepts valid XRP address', () => {
    // XRP addresses start with 'r', 25-35 base58 chars total
    const address = 'r' + 'N'.repeat(29);
    const result = normalizeXrpAddress(address);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toMatch(/^r/);
  });

  test('accepts minimum-length XRP address', () => {
    const address = 'r' + 'N'.repeat(24);
    const result = normalizeXrpAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('accepts maximum-length XRP address', () => {
    const address = 'r' + 'N'.repeat(34);
    const result = normalizeXrpAddress(address);
    expect(result.isOk()).toBe(true);
  });

  test('rejects address not starting with r', () => {
    const result = normalizeXrpAddress('x' + 'N'.repeat(29));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid XRP address format/);
  });

  test('rejects address that is too short', () => {
    const result = normalizeXrpAddress('r' + 'N'.repeat(5));
    expect(result.isErr()).toBe(true);
  });

  test('rejects address with invalid base58 characters', () => {
    const result = normalizeXrpAddress('r' + '0'.repeat(29));
    expect(result.isErr()).toBe(true);
  });

  test('rejects empty string', () => {
    const result = normalizeXrpAddress('');
    expect(result.isErr()).toBe(true);
  });
});
