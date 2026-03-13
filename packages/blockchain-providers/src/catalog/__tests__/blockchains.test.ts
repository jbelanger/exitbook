import { describe, expect, it } from 'vitest';

import { BLOCKCHAIN_CATALOG, getBlockchainCatalogEntry } from '../blockchains.js';

describe('blockchain catalog', () => {
  it('aggregates EVM and singleton chain provider hints', () => {
    expect(BLOCKCHAIN_CATALOG['ethereum']?.providerHints?.coingecko?.chainIdentifier).toBe(1);
    expect(BLOCKCHAIN_CATALOG['solana']?.providerHints?.coingecko?.platformId).toBe('solana');
    expect(BLOCKCHAIN_CATALOG['near']?.providerHints?.coingecko?.platformId).toBe('near-protocol');
    expect(BLOCKCHAIN_CATALOG['cardano']?.providerHints?.coingecko?.platformId).toBe('cardano');
  });

  it('returns undefined for unknown chains', () => {
    expect(getBlockchainCatalogEntry('not-a-chain')).toBeUndefined();
  });
});
