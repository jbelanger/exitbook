import type { Currency } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { resolveTaxAssetIdentity } from './tax-asset-identity.js';

describe('resolveTaxAssetIdentity', () => {
  it('trusts imported symbols for exchange assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
      },
      {
        policy: 'strict-onchain-tokens',
        relaxedSymbolIdentities: [],
      }
    );

    expect(assertOk(result).identityKey).toBe('btc');
  });

  it('trusts imported symbols for blockchain native assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
      },
      {
        policy: 'strict-onchain-tokens',
        relaxedSymbolIdentities: [],
      }
    );

    expect(assertOk(result).identityKey).toBe('btc');
  });

  it('keeps on-chain tokens strict by default', () => {
    const assetId = 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const result = resolveTaxAssetIdentity(
      {
        assetId,
        assetSymbol: 'USDC' as Currency,
      },
      {
        policy: 'strict-onchain-tokens',
        relaxedSymbolIdentities: [],
      }
    );

    expect(assertOk(result).identityKey).toBe(assetId);
  });

  it('collapses selected stablecoin symbols under the relaxed policy', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        assetSymbol: 'USDC' as Currency,
      },
      {
        policy: 'relaxed-stablecoin-symbols',
        relaxedSymbolIdentities: ['usdc'],
      }
    );

    expect(assertOk(result).identityKey).toBe('usdc');
  });

  it('rejects fiat assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'fiat:usd',
        assetSymbol: 'USD' as Currency,
      },
      {
        policy: 'strict-onchain-tokens',
        relaxedSymbolIdentities: [],
      }
    );

    expect(assertErr(result).message).toContain('non-fiat asset');
  });
});
