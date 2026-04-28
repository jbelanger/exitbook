import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildLedgerLinkingAssetIdentityResolver,
  canonicalizeLedgerLinkingAssetIdentityPair,
  type LedgerLinkingAssetIdentityAssertion,
} from '../asset-identity-resolution.js';

describe('canonicalizeLedgerLinkingAssetIdentityPair', () => {
  it('sorts asset identity pairs so assertions are symmetric', () => {
    expect(
      assertOk(canonicalizeLedgerLinkingAssetIdentityPair('exchange:kraken:eth', 'blockchain:ethereum:native'))
    ).toEqual({
      assetIdA: 'blockchain:ethereum:native',
      assetIdB: 'exchange:kraken:eth',
    });
  });

  it('rejects identical asset ids because no assertion is needed', () => {
    const result = canonicalizeLedgerLinkingAssetIdentityPair('exchange:kraken:eth', 'exchange:kraken:eth');

    expect(assertErr(result).message).toContain('unnecessary for identical asset id');
  });
});

describe('buildLedgerLinkingAssetIdentityResolver', () => {
  it('accepts identical asset ids without an assertion', () => {
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver());

    expect(
      resolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: 'blockchain:ethereum:native',
        targetAssetId: 'blockchain:ethereum:native',
      })
    ).toEqual({
      reason: 'same_asset_id',
      status: 'accepted',
    });
  });

  it('accepts different asset ids when an explicit assertion exists for the relationship kind', () => {
    const assertion = makeAssertion({
      assetIdA: 'exchange:kraken:eth',
      assetIdB: 'blockchain:ethereum:native',
    });
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver([assertion]));

    expect(
      resolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: 'blockchain:ethereum:native',
        targetAssetId: 'exchange:kraken:eth',
      })
    ).toEqual({
      assertion: {
        ...assertion,
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
      },
      reason: 'accepted_assertion',
      status: 'accepted',
    });
  });

  it('keeps assertions scoped by relationship kind', () => {
    const resolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([
        makeAssertion({
          relationshipKind: 'bridge',
        }),
      ])
    );

    expect(
      resolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: 'exchange:kraken:eth',
        targetAssetId: 'blockchain:ethereum:native',
      })
    ).toEqual({
      reason: 'missing_assertion',
      status: 'blocked',
    });
  });

  it('rejects duplicate assertions after canonicalizing the pair', () => {
    const result = buildLedgerLinkingAssetIdentityResolver([
      makeAssertion({
        assetIdA: 'exchange:kraken:eth',
        assetIdB: 'blockchain:ethereum:native',
      }),
      makeAssertion({
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
      }),
    ]);

    expect(assertErr(result).message).toContain('Duplicate ledger-linking asset identity assertion');
  });
});

function makeAssertion(
  overrides: Partial<LedgerLinkingAssetIdentityAssertion> = {}
): LedgerLinkingAssetIdentityAssertion {
  return {
    assetIdA: 'exchange:kraken:eth',
    assetIdB: 'blockchain:ethereum:native',
    evidenceKind: 'manual',
    relationshipKind: 'internal_transfer',
    ...overrides,
  };
}
