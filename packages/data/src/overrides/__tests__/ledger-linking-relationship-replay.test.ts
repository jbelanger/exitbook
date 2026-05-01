import { buildReviewedLedgerLinkingRelationshipStableKey } from '@exitbook/accounting/ledger-linking';
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
      allocations: [
        {
          allocation_side: 'source',
          asset_id: 'exchange:kraken:eth',
          asset_symbol: 'ETH',
          journal_fingerprint: 'ledger_journal:v1:source',
          posting_fingerprint: 'ledger_posting:v1:source',
          quantity: '10',
          source_activity_fingerprint: 'source_activity:v1:source',
        },
        {
          allocation_side: 'target',
          asset_id: 'blockchain:ethereum:native',
          asset_symbol: 'ETH',
          journal_fingerprint: 'ledger_journal:v1:target',
          posting_fingerprint: 'ledger_posting:v1:target',
          quantity: '10',
          source_activity_fingerprint: 'source_activity:v1:target',
        },
      ],
      evidence: {
        assetIdentityReason: 'accepted_assertion',
        proposalUniqueness: 'unique_pair',
      },
      proposal_kind: 'amount_time',
      relationship_kind: 'internal_transfer',
      review_id: 'lp_test_1',
      type: 'ledger_linking_relationship_accept',
      ...overrides,
    },
  };
}

function createRevokeEvent(relationshipStableKey: string, createdAt = '2026-04-29T00:01:00.000Z'): OverrideEvent {
  return {
    actor: 'user',
    created_at: createdAt,
    id: `ledger-linking-relationship-revoke:${createdAt}`,
    profile_key: PROFILE_KEY,
    scope: 'ledger-linking-relationship-revoke',
    source: 'cli',
    payload: {
      relationship_stable_key: relationshipStableKey,
      type: 'ledger_linking_relationship_revoke',
    },
  };
}

describe('ledger-linking relationship override replay', () => {
  it('replays accepted reviewed relationship overrides with latest event winning per relationship', () => {
    const result = replayLedgerLinkingRelationshipOverrides([
      createAcceptEvent({}, '2026-04-29T00:00:00.000Z'),
      createAcceptEvent({ evidence: { proposalUniqueness: 'ambiguous_source' } }, '2026-04-29T00:01:00.000Z'),
    ]);

    expect(assertOk(result)).toEqual([
      {
        acceptedAt: '2026-04-29T00:01:00.000Z',
        allocations: [
          {
            allocationSide: 'source',
            assetId: 'exchange:kraken:eth',
            assetSymbol: 'ETH',
            journalFingerprint: 'ledger_journal:v1:source',
            postingFingerprint: 'ledger_posting:v1:source',
            quantity: new Decimal(10),
            sourceActivityFingerprint: 'source_activity:v1:source',
          },
          {
            allocationSide: 'target',
            assetId: 'blockchain:ethereum:native',
            assetSymbol: 'ETH',
            journalFingerprint: 'ledger_journal:v1:target',
            postingFingerprint: 'ledger_posting:v1:target',
            quantity: new Decimal(10),
            sourceActivityFingerprint: 'source_activity:v1:target',
          },
        ],
        evidence: {
          proposalUniqueness: 'ambiguous_source',
        },
        overrideEventId: 'ledger-linking-relationship:2026-04-29T00:01:00.000Z',
        proposalKind: 'amount_time',
        relationshipKind: 'internal_transfer',
        reviewId: 'lp_test_1',
      },
    ]);
  });

  it('applies revoke events in append order', () => {
    const acceptedResult = replayLedgerLinkingRelationshipOverrides([createAcceptEvent()]);
    const [accepted] = assertOk(acceptedResult);

    if (accepted === undefined) {
      throw new Error('Expected reviewed relationship override');
    }

    const relationshipStableKey = buildReviewedLedgerLinkingRelationshipStableKey(accepted);
    const result = replayLedgerLinkingRelationshipOverrides([
      createAcceptEvent({}, '2026-04-29T00:00:00.000Z'),
      createRevokeEvent(relationshipStableKey, '2026-04-29T00:01:00.000Z'),
    ]);

    expect(assertOk(result)).toEqual([]);
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
    const result = replayLedgerLinkingRelationshipOverrides([
      createAcceptEvent({
        allocations: [
          {
            allocation_side: 'source',
            asset_id: 'exchange:kraken:eth',
            asset_symbol: 'ETH',
            journal_fingerprint: 'ledger_journal:v1:source',
            posting_fingerprint: 'ledger_posting:v1:source',
            quantity: 'not-a-number',
            source_activity_fingerprint: 'source_activity:v1:source',
          },
          {
            allocation_side: 'target',
            asset_id: 'blockchain:ethereum:native',
            asset_symbol: 'ETH',
            journal_fingerprint: 'ledger_journal:v1:target',
            posting_fingerprint: 'ledger_posting:v1:target',
            quantity: '10',
            source_activity_fingerprint: 'source_activity:v1:target',
          },
        ],
      }),
    ]);

    expect(assertErr(result).message).toContain(
      'Invalid ledger-linking relationship override ledger-linking-relationship:2026-04-29T00:00:00.000Z: source allocation ledger_posting:v1:source quantity must be positive'
    );
  });

  it('reads accepted reviewed relationships from the override store', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(ok([createAcceptEvent()])),
    };

    const result = await readLedgerLinkingRelationshipOverrides(overrideStore, PROFILE_KEY);

    expect(assertOk(result)).toHaveLength(1);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith(PROFILE_KEY, [
      'ledger-linking-relationship-accept',
      'ledger-linking-relationship-revoke',
    ]);
  });
});
