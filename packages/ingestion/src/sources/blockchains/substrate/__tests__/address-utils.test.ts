import { describe, expect, test } from 'vitest';

import { normalizeSubstrateAddress } from '../address-utils.js';

// Real SS58 addresses from Polkadot ecosystem (SS58 format 42 / generic Substrate)
const POLKADOT_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Alice
const KUSAMA_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'; // Bob
const BITTENSOR_ADDRESS = '5HEo565WAy4Dbq3Sv271SAi7syBSofyfhhwRNjFNSM2gP9M2';

describe('normalizeSubstrateAddress', () => {
  test('accepts valid Polkadot SS58 address', () => {
    const result = normalizeSubstrateAddress(POLKADOT_ADDRESS, 'polkadot');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(POLKADOT_ADDRESS);
  });

  test('accepts valid Kusama SS58 address', () => {
    const result = normalizeSubstrateAddress(KUSAMA_ADDRESS, 'kusama');
    expect(result.isOk()).toBe(true);
  });

  test('accepts valid Bittensor address', () => {
    const result = normalizeSubstrateAddress(BITTENSOR_ADDRESS, 'bittensor');
    expect(result.isOk()).toBe(true);
  });

  test('preserves original casing', () => {
    const result = normalizeSubstrateAddress(POLKADOT_ADDRESS, 'polkadot');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toBe(POLKADOT_ADDRESS);
  });

  test('rejects a syntactically invalid address', () => {
    const result = normalizeSubstrateAddress('not-a-valid-address', 'polkadot');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toMatch(/Invalid Substrate address format/);
  });

  test('includes chain name in error message', () => {
    const result = normalizeSubstrateAddress('bad', 'kusama');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('kusama');
  });

  test('rejects empty string', () => {
    const result = normalizeSubstrateAddress('', 'polkadot');
    expect(result.isErr()).toBe(true);
  });
});
