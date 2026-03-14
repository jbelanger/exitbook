import { describe, expect, it } from 'vitest';

import { CHAIN_CATALOG, getChainCatalogEntry } from '../chain-catalog.js';

describe('chain catalog', () => {
  it('aggregates EVM and singleton chain provider hints', () => {
    expect(CHAIN_CATALOG['ethereum']?.providerHints?.coingecko?.chainIdentifier).toBe(1);
    expect(CHAIN_CATALOG['ethereum']?.providerHints?.coingecko?.tokenRefFormat).toBe('evm-contract');
    expect(CHAIN_CATALOG['solana']?.providerHints?.coingecko?.platformId).toBe('solana');
    expect(CHAIN_CATALOG['solana']?.providerHints?.coingecko?.tokenRefFormat).toBe('platform-address');
    expect(CHAIN_CATALOG['near']?.providerHints?.coingecko?.platformId).toBe('near-protocol');
    expect(CHAIN_CATALOG['near']?.providerHints?.coingecko?.tokenRefFormat).toBe('platform-address');
    expect(CHAIN_CATALOG['cardano']?.providerHints?.coingecko?.platformId).toBe('cardano');
    expect(CHAIN_CATALOG['cardano']?.providerHints?.coingecko?.tokenRefFormat).toBe('platform-address');
    expect(CHAIN_CATALOG['theta']?.providerHints?.coingecko?.chainIdentifier).toBe(361);
    expect(CHAIN_CATALOG['theta']?.providerHints?.coingecko?.tokenRefFormat).toBe('evm-contract');
  });

  it('returns undefined for unknown chains', () => {
    expect(getChainCatalogEntry('not-a-chain')).toBeUndefined();
  });
});
