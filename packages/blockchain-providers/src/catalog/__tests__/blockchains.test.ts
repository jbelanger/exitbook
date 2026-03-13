import { describe, expect, it } from 'vitest';

import { CHAIN_CATALOG, getChainCatalogEntry } from '../chain-catalog.js';

describe('chain catalog', () => {
  it('aggregates EVM and singleton chain provider hints', () => {
    expect(CHAIN_CATALOG['ethereum']?.providerHints?.coingecko?.chainIdentifier).toBe(1);
    expect(CHAIN_CATALOG['solana']?.providerHints?.coingecko?.platformId).toBe('solana');
    expect(CHAIN_CATALOG['near']?.providerHints?.coingecko?.platformId).toBe('near-protocol');
    expect(CHAIN_CATALOG['cardano']?.providerHints?.coingecko?.platformId).toBe('cardano');
  });

  it('returns undefined for unknown chains', () => {
    expect(getChainCatalogEntry('not-a-chain')).toBeUndefined();
  });
});
