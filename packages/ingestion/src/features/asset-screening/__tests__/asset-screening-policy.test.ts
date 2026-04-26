import { describe, expect, it } from 'vitest';

import { buildReferenceBalanceAssetScreeningPolicy } from '../asset-screening-policy.js';

describe('buildReferenceBalanceAssetScreeningPolicy', () => {
  it('builds a token contract allowlist from tracked non-suppressed reference assets', () => {
    const result = buildReferenceBalanceAssetScreeningPolicy({
      blockchain: 'ethereum',
      calculatedAssetIds: [
        'blockchain:ethereum:native',
        'blockchain:ethereum:0x1111111111111111111111111111111111111111',
        'blockchain:ethereum:0x2222222222222222222222222222222222222222',
      ],
      balanceAdjustmentAssetIds: ['blockchain:ethereum:0x3333333333333333333333333333333333333333'],
      suppressedAssetReasons: new Map([
        ['blockchain:ethereum:0x2222222222222222222222222222222222222222', 'spam-diagnostic'],
      ]),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.getTokenContractAllowlist('ethereum')).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x3333333333333333333333333333333333333333',
    ]);
    expect(result.value.screenReferenceAsset('blockchain:ethereum:0x1111111111111111111111111111111111111111')).toEqual(
      {
        action: 'include',
        assetId: 'blockchain:ethereum:0x1111111111111111111111111111111111111111',
        reason: 'tracked-reference-asset',
      }
    );
    expect(result.value.screenReferenceAsset('blockchain:ethereum:0x2222222222222222222222222222222222222222')).toEqual(
      {
        action: 'suppress',
        assetId: 'blockchain:ethereum:0x2222222222222222222222222222222222222222',
        reason: 'spam-diagnostic',
      }
    );
  });

  it('suppresses untracked token assets in tracked-reference mode', () => {
    const result = buildReferenceBalanceAssetScreeningPolicy({
      blockchain: 'ethereum',
      calculatedAssetIds: ['blockchain:ethereum:native'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.getTokenContractAllowlist('ethereum')).toEqual([]);
    expect(result.value.screenReferenceAsset('blockchain:ethereum:0x9999999999999999999999999999999999999999')).toEqual(
      {
        action: 'suppress',
        assetId: 'blockchain:ethereum:0x9999999999999999999999999999999999999999',
        reason: 'outside-reference-scope',
      }
    );
  });

  it('does not build an allowlist in discover-all mode', () => {
    const result = buildReferenceBalanceAssetScreeningPolicy({
      blockchain: 'ethereum',
      calculatedAssetIds: ['blockchain:ethereum:native'],
      discoveryMode: 'discover-all-reference-assets',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.getTokenContractAllowlist('ethereum')).toBeUndefined();
    expect(result.value.screenReferenceAsset('blockchain:ethereum:0x9999999999999999999999999999999999999999')).toEqual(
      {
        action: 'include',
        assetId: 'blockchain:ethereum:0x9999999999999999999999999999999999999999',
        reason: 'discovered-reference-asset',
      }
    );
  });
});
