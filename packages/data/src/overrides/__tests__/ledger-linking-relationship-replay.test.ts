import type { LedgerLinkingRelationshipAcceptPayload, OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import {
  readLedgerLinkingRelationshipOverrides,
  replayLedgerLinkingRelationshipOverrides,
} from '../ledger-linking-relationship-replay.js';

const PROFILE_KEY = 'default';

function createAcceptEvent(
  overrides: Partial<LedgerLinkingRelationshipAcceptPayload> = {},
  createdAt = '2026-04-29T00:00:00.000Z'
): OverrideEvent {
  return {
    actor: 'user',
    created_at: createdAt,
    id: `ledger-linking-relationship:${createdAt}`,
    profile_key: PROFILE_KEY,
    scope: 'ledger-linking-relationship-accept',
    source: 'cli',
    payload: {
      asset_identity_reason: 'accepted_assertion',
      asset_symbol: 'ETH',
      proposal_kind: 'amount_time',
      proposal_uniqueness: 'unique_pair',
      quantity: '10',
      relationship_kind: 'internal_transfer',
      review_id: 'lp_test_1',
      source_activity_fingerprint: 'source_activity:v1:source',
      source_asset_id: 'exchange:kraken:eth',
      source_journal_fingerprint: 'ledger_journal:v1:source',
      source_posting_fingerprint: 'ledger_posting:v1:source',
      target_activity_fingerprint: 'source_activity:v1:target',
      target_asset_id: 'blockchain:ethereum:native',
      target_journal_fingerprint: 'ledger_journal:v1:target',
      target_posting_fingerprint: 'ledger_posting:v1:target',
      time_direction: 'source_before_target',
      time_distance_seconds: 30,
      type: 'ledger_linking_relationship_accept',
      ...overrides,
    },
  };
}

describe('ledger-linking relationship override replay', () => {
  it('replays accepted reviewed relationship overrides with latest event winning per relationship', () => {
    const result = replayLedgerLinkingRelationshipOverrides([
      createAcceptEvent({ quantity: '10' }, '2026-04-29T00:00:00.000Z'),
      createAcceptEvent({ quantity: '10', proposal_uniqueness: 'ambiguous_source' }, '2026-04-29T00:01:00.000Z'),
    ]);

    expect(assertOk(result)).toEqual([
      {
        acceptedAt: '2026-04-29T00:01:00.000Z',
        assetIdentityReason: 'accepted_assertion',
        assetSymbol: 'ETH',
        overrideEventId: 'ledger-linking-relationship:2026-04-29T00:01:00.000Z',
        proposalKind: 'amount_time',
        proposalUniqueness: 'ambiguous_source',
        quantity: new Decimal(10),
        relationshipKind: 'internal_transfer',
        reviewId: 'lp_test_1',
        sourceActivityFingerprint: 'source_activity:v1:source',
        sourceAssetId: 'exchange:kraken:eth',
        sourceJournalFingerprint: 'ledger_journal:v1:source',
        sourcePostingFingerprint: 'ledger_posting:v1:source',
        targetActivityFingerprint: 'source_activity:v1:target',
        targetAssetId: 'blockchain:ethereum:native',
        targetJournalFingerprint: 'ledger_journal:v1:target',
        targetPostingFingerprint: 'ledger_posting:v1:target',
        timeDirection: 'source_before_target',
        timeDistanceSeconds: 30,
      },
    ]);
  });

  it('rejects unsupported scopes', () => {
    const result = replayLedgerLinkingRelationshipOverrides([
      {
        ...createAcceptEvent(),
        payload: {
          asset_id: 'exchange:kraken:eth',
          evidence_fingerprint: 'asset-review:v1:test',
          type: 'asset_review_confirm',
        },
        scope: 'asset-review-confirm',
      },
    ]);

    expect(assertErr(result).message).toContain("unsupported scope 'asset-review-confirm'");
  });

  it('rejects invalid quantities without throwing', () => {
    const result = replayLedgerLinkingRelationshipOverrides([createAcceptEvent({ quantity: 'not-a-number' })]);

    expect(assertErr(result).message).toContain(
      'Invalid ledger-linking relationship override ledger-linking-relationship:2026-04-29T00:00:00.000Z: quantity must be positive'
    );
  });

  it('reads accepted reviewed relationships from the override store', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(ok([createAcceptEvent()])),
    };

    const result = await readLedgerLinkingRelationshipOverrides(overrideStore, PROFILE_KEY);

    expect(assertOk(result)).toHaveLength(1);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith(PROFILE_KEY, ['ledger-linking-relationship-accept']);
  });
});
