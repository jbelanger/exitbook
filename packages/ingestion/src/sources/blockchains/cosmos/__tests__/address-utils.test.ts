import { describe, expect, test } from 'vitest';

import { normalizeCosmosAddress } from '../address-utils.js';

// Real bech32 addresses from Cosmos ecosystem
const INJECTIVE_ADDRESS = 'inj1zk3259rhsxcg5qg96eursm4x8ek2qc5pty4rau';
const OSMOSIS_ADDRESS = 'osmo1tctqykwxyypr475mdnd83kc643tyca63rxdfl9';

describe('normalizeCosmosAddress', () => {
  test('accepts valid lowercase injective address', () => {
    const result = normalizeCosmosAddress(INJECTIVE_ADDRESS, 'injective');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(INJECTIVE_ADDRESS);
  });

  test('accepts and lowercases uppercase address', () => {
    const result = normalizeCosmosAddress(INJECTIVE_ADDRESS.toUpperCase(), 'injective');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(INJECTIVE_ADDRESS);
  });

  test('accepts valid osmosis address', () => {
    const result = normalizeCosmosAddress(OSMOSIS_ADDRESS, 'osmosis');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(OSMOSIS_ADDRESS);
  });

  test('rejects plaintext that is not bech32', () => {
    const result = normalizeCosmosAddress('not-a-valid-address', 'cosmos');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid Cosmos address format/);
  });

  test('rejects empty string', () => {
    const result = normalizeCosmosAddress('', 'cosmos');
    expect(result.isErr()).toBe(true);
  });

  test('includes chain name in error message', () => {
    const result = normalizeCosmosAddress('invalid', 'osmosis');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('osmosis');
  });
});
