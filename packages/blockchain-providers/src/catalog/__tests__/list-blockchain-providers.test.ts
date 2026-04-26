import { describe, expect, it } from 'vitest';

import { listBlockchainProviders } from '../list-blockchain-providers.js';

describe('listBlockchainProviders', () => {
  it('preserves per-chain provider registrations for Cosmos SDK chains', () => {
    const providers = listBlockchainProviders();

    expect(providers.some((provider) => provider.blockchain === 'fetch' && provider.name === 'cosmos-rest')).toBe(true);
    expect(providers.some((provider) => provider.blockchain === 'cosmoshub')).toBe(false);
    expect(providers.some((provider) => provider.blockchain === 'injective' && provider.name === 'cosmos-rest')).toBe(
      false
    );
    expect(
      providers.some((provider) => provider.blockchain === 'injective' && provider.name === 'injective-explorer')
    ).toBe(true);
    expect(providers.some((provider) => provider.blockchain === 'akash' && provider.name === 'akash-console')).toBe(
      true
    );
  });
});
