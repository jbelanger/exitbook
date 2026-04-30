import { parseCurrency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerReviewedRelationshipOverrides,
  buildReviewedLedgerLinkingRelationshipStableKey,
  LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY,
  type LedgerLinkingReviewedRelationshipOverride,
} from '../reviewed-relationship-override-matching.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('reviewed relationship override matching', () => {
  it('builds a reviewed amount/time relationship from stable posting fingerprints', () => {
    const accepted = makeReviewedOverride();
    const result = buildLedgerReviewedRelationshipOverrides(
      [makeCandidate('source'), makeCandidate('target')],
      [accepted]
    );

    const relationshipStableKey = buildReviewedLedgerLinkingRelationshipStableKey(accepted);

    expect(assertOk(result)).toEqual({
      candidateClaims: [
        {
          candidateId: 1,
          quantity: new Decimal(10),
        },
        {
          candidateId: 2,
          quantity: new Decimal(10),
        },
      ],
      payload: {
        matches: [
          {
            overrideEventId: 'override-event-1',
            relationshipStableKey,
            reviewId: 'lp_test_1',
            sourceCandidateId: 1,
            targetCandidateId: 2,
          },
        ],
      },
      relationships: [
        {
          allocations: [
            {
              allocationSide: 'source',
              journalFingerprint: 'ledger_journal:v1:source',
              postingFingerprint: 'ledger_posting:v1:source',
              quantity: new Decimal(10),
              sourceActivityFingerprint: 'source_activity:v1:source',
            },
            {
              allocationSide: 'target',
              journalFingerprint: 'ledger_journal:v1:target',
              postingFingerprint: 'ledger_posting:v1:target',
              quantity: new Decimal(10),
              sourceActivityFingerprint: 'source_activity:v1:target',
            },
          ],
          confidenceScore: new Decimal(1),
          evidence: {
            acceptedAt: '2026-04-29T00:00:00.000Z',
            amount: '10',
            assetIdentityReason: 'accepted_assertion',
            assetSymbol: 'ETH',
            overrideEventId: 'override-event-1',
            proposalKind: 'amount_time',
            proposalUniqueness: 'unique_pair',
            reviewId: 'lp_test_1',
            sourceAssetId: 'exchange:kraken:eth',
            sourcePostingFingerprint: 'ledger_posting:v1:source',
            targetAssetId: 'blockchain:ethereum:native',
            targetPostingFingerprint: 'ledger_posting:v1:target',
            timeDirection: 'source_before_target',
            timeDistanceSeconds: 30,
          },
          recognitionStrategy: LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY,
          relationshipKind: 'internal_transfer',
          relationshipStableKey,
        },
      ],
    });
  });

  it('fails closed when a reviewed posting no longer resolves', () => {
    const result = buildLedgerReviewedRelationshipOverrides([makeCandidate('source')], [makeReviewedOverride()]);

    expect(assertErr(result).message).toContain(
      'Reviewed ledger-linking relationship lp_test_1 no longer resolves target posting ledger_posting:v1:target'
    );
  });

  it('fails closed when a reviewed posting asset changes', () => {
    const result = buildLedgerReviewedRelationshipOverrides(
      [
        makeCandidate('source'),
        {
          ...makeCandidate('target'),
          assetId: 'blockchain:ethereum:unexpected',
        },
      ],
      [makeReviewedOverride()]
    );

    expect(assertErr(result).message).toContain(
      'target posting ledger_posting:v1:target asset changed from blockchain:ethereum:native to blockchain:ethereum:unexpected'
    );
  });

  it('rejects reviewed quantities that exceed the current candidate amount', () => {
    const result = buildLedgerReviewedRelationshipOverrides(
      [
        {
          ...makeCandidate('source'),
          amount: new Decimal(9),
        },
        makeCandidate('target'),
      ],
      [makeReviewedOverride()]
    );

    expect(assertErr(result).message).toContain('overclaims source posting ledger_posting:v1:source: 10 of 9');
  });
});

function makeReviewedOverride(
  overrides: Partial<LedgerLinkingReviewedRelationshipOverride> = {}
): LedgerLinkingReviewedRelationshipOverride {
  return {
    acceptedAt: '2026-04-29T00:00:00.000Z',
    assetIdentityReason: 'accepted_assertion',
    assetSymbol: ETH,
    overrideEventId: 'override-event-1',
    proposalKind: 'amount_time',
    proposalUniqueness: 'unique_pair',
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
    ...overrides,
  };
}

function makeCandidate(direction: 'source' | 'target'): LedgerTransferLinkingCandidate {
  return {
    activityDatetime:
      direction === 'source' ? new Date('2026-04-29T00:00:00.000Z') : new Date('2026-04-29T00:00:30.000Z'),
    amount: new Decimal(10),
    assetId: direction === 'source' ? 'exchange:kraken:eth' : 'blockchain:ethereum:native',
    assetSymbol: ETH,
    blockchainTransactionHash: undefined,
    candidateId: direction === 'source' ? 1 : 2,
    direction,
    fromAddress: undefined,
    journalFingerprint: direction === 'source' ? 'ledger_journal:v1:source' : 'ledger_journal:v1:target',
    ownerAccountId: 1,
    platformKey: direction === 'source' ? 'kraken' : 'ethereum',
    platformKind: direction === 'source' ? 'exchange' : 'blockchain',
    postingFingerprint: direction === 'source' ? 'ledger_posting:v1:source' : 'ledger_posting:v1:target',
    sourceActivityFingerprint: direction === 'source' ? 'source_activity:v1:source' : 'source_activity:v1:target',
    toAddress: undefined,
  };
}
