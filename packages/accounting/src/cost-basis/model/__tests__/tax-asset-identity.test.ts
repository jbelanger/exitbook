import type { Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { resolveTaxAssetIdentity } from '../tax-asset-identity.js';

describe('resolveTaxAssetIdentity', () => {
  it('trusts imported symbols for exchange assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
      },
      {}
    );

    expect(assertOk(result).identityKey).toBe('btc');
  });

  it('trusts imported symbols for blockchain native assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
      },
      {}
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
      {}
    );

    expect(assertOk(result).identityKey).toBe(assetId);
  });

  it('uses explicit asset identity overrides for linked blockchain tokens', () => {
    const assetId = 'blockchain:ethereum:0x514910771af9ca656af840dff83e8264ecf986ca';
    const result = resolveTaxAssetIdentity(
      {
        assetId,
        assetSymbol: 'LINK' as Currency,
      },
      {
        assetIdentityOverridesByAssetId: new Map([[assetId, 'link']]),
      }
    );

    expect(assertOk(result).identityKey).toBe('link');
  });

  it('rejects fiat assets', () => {
    const result = resolveTaxAssetIdentity(
      {
        assetId: 'fiat:usd',
        assetSymbol: 'USD' as Currency,
      },
      {}
    );

    expect(assertErr(result).message).toContain('non-fiat asset');
  });
});
