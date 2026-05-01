import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  materializeStoredLedgerLinkingAssetIdentityAssertions,
  readLedgerLinkingAssetIdentityAssertionOverrides,
  replayLedgerLinkingAssetIdentityAssertionOverrides,
} from '../ledger-linking-asset-identity-replay.js';

const PROFILE_KEY = 'default';

function createAcceptEvent(
  assetIdA: string,
  assetIdB: string,
  evidenceKind: 'manual' | 'seeded' | 'exact_hash_observed' | 'amount_time_observed' = 'manual',
  createdAt = '2026-04-29T00:00:00.000Z'
): OverrideEvent {
  return {
    actor: 'user',
    created_at: createdAt,
    id: `ledger-linking-asset-identity:${assetIdA}:${assetIdB}:${createdAt}`,
    profile_key: PROFILE_KEY,
    scope: 'ledger-linking-asset-identity-accept',
    source: 'cli',
    payload: {
      asset_id_a: assetIdA,
      asset_id_b: assetIdB,
      evidence_kind: evidenceKind,
      relationship_kind: 'internal_transfer',
      type: 'ledger_linking_asset_identity_accept',
    },
  };
}

function createRevokeEvent(
  assetIdA: string,
  assetIdB: string,
  relationshipKind = 'internal_transfer',
  createdAt = '2026-04-29T00:01:00.000Z'
): OverrideEvent {
  return {
    actor: 'user',
    created_at: createdAt,
    id: `ledger-linking-asset-identity-revoke:${assetIdA}:${assetIdB}:${createdAt}`,
    profile_key: PROFILE_KEY,
    scope: 'ledger-linking-asset-identity-revoke',
    source: 'cli',
    payload: {
      asset_id_a: assetIdA,
      asset_id_b: assetIdB,
      relationship_kind: relationshipKind,
      type: 'ledger_linking_asset_identity_revoke',
    },
  };
}

describe('ledger-linking asset identity override replay', () => {
  it('replays accepted asset identity assertions with latest event wins', () => {
    const result = replayLedgerLinkingAssetIdentityAssertionOverrides([
      createAcceptEvent('exchange:kraken:eth', 'blockchain:ethereum:native', 'manual', '2026-04-29T00:00:00.000Z'),
      createAcceptEvent(
        'blockchain:ethereum:native',
        'exchange:kraken:eth',
        'exact_hash_observed',
        '2026-04-29T00:01:00.000Z'
      ),
      createAcceptEvent('blockchain:bitcoin:native', 'exchange:kraken:btc', 'seeded', '2026-04-29T00:02:00.000Z'),
    ]);

    expect(assertOk(result)).toEqual([
      {
        assetIdA: 'blockchain:bitcoin:native',
        assetIdB: 'exchange:kraken:btc',
        evidenceKind: 'seeded',
        relationshipKind: 'internal_transfer',
      },
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'exact_hash_observed',
        relationshipKind: 'internal_transfer',
      },
    ]);
  });

  it('applies revoke events in append order', () => {
    const result = replayLedgerLinkingAssetIdentityAssertionOverrides([
      createAcceptEvent('exchange:kraken:eth', 'blockchain:ethereum:native', 'manual', '2026-04-29T00:00:00.000Z'),
      createRevokeEvent(
        'blockchain:ethereum:native',
        'exchange:kraken:eth',
        'internal_transfer',
        '2026-04-29T00:01:00.000Z'
      ),
      createAcceptEvent('blockchain:bitcoin:native', 'exchange:kraken:btc', 'seeded', '2026-04-29T00:02:00.000Z'),
    ]);

    expect(assertOk(result)).toEqual([
      {
        assetIdA: 'blockchain:bitcoin:native',
        assetIdB: 'exchange:kraken:btc',
        evidenceKind: 'seeded',
        relationshipKind: 'internal_transfer',
      },
    ]);
  });

  it('rejects unsupported scopes', () => {
    const result = replayLedgerLinkingAssetIdentityAssertionOverrides([
      {
        ...createAcceptEvent('exchange:kraken:eth', 'blockchain:ethereum:native'),
        scope: 'asset-review-confirm',
        payload: {
          asset_id: 'exchange:kraken:eth',
          evidence_fingerprint: 'asset-review:v1:test',
          type: 'asset_review_confirm',
        },
      },
    ]);

    expect(assertErr(result).message).toContain("unsupported scope 'asset-review-confirm'");
  });

  it('reads accepted assertions from the override store', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi
        .fn()
        .mockResolvedValue(ok([createAcceptEvent('exchange:kraken:eth', 'blockchain:ethereum:native')])),
    };

    const result = await readLedgerLinkingAssetIdentityAssertionOverrides(overrideStore, PROFILE_KEY);

    expect(assertOk(result)).toEqual([
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
    ]);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith(PROFILE_KEY, [
      'ledger-linking-asset-identity-accept',
      'ledger-linking-asset-identity-revoke',
    ]);
  });

  it('materializes replayed assertions into the SQL projection store', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi
        .fn()
        .mockResolvedValue(ok([createAcceptEvent('exchange:kraken:eth', 'blockchain:ethereum:native')])),
    };
    const assertionStore = {
      replaceLedgerLinkingAssetIdentityAssertions: vi.fn().mockResolvedValue(
        ok({
          previousCount: 0,
          savedCount: 1,
        })
      ),
    };

    const result = await materializeStoredLedgerLinkingAssetIdentityAssertions(
      assertionStore,
      overrideStore,
      7,
      PROFILE_KEY
    );

    expect(assertOk(result)).toEqual({
      previousCount: 0,
      savedCount: 1,
    });
    expect(overrideStore.readByScopes).toHaveBeenCalledWith(PROFILE_KEY, [
      'ledger-linking-asset-identity-accept',
      'ledger-linking-asset-identity-revoke',
    ]);
    expect(assertionStore.replaceLedgerLinkingAssetIdentityAssertions).toHaveBeenCalledWith(7, [
      {
        assetIdA: 'blockchain:ethereum:native',
        assetIdB: 'exchange:kraken:eth',
        evidenceKind: 'manual',
        relationshipKind: 'internal_transfer',
      },
    ]);
  });
});
