import { parseCurrency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import {
  buildLedgerReviewedRelationshipOverrides,
  buildReviewedLedgerLinkingRelationshipStableKey,
  LEDGER_REVIEWED_RELATIONSHIP_STRATEGY,
  type LedgerLinkingReviewedRelationshipOverride,
} from '../reviewed-relationship-override-matching.js';

const ETH = assertOk(parseCurrency('ETH'));
const RENDER = assertOk(parseCurrency('RENDER'));
const RNDR = assertOk(parseCurrency('RNDR'));

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
            allocations: [
              {
                allocationSide: 'source',
                candidateId: 1,
                postingFingerprint: 'ledger_posting:v1:source',
                quantity: '10',
              },
              {
                allocationSide: 'target',
                candidateId: 2,
                postingFingerprint: 'ledger_posting:v1:target',
                quantity: '10',
              },
            ],
            overrideEventId: 'override-event-1',
            relationshipStableKey,
            reviewId: 'lp_test_1',
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
            overrideEventId: 'override-event-1',
            proposalKind: 'amount_time',
            reviewEvidence: {
              assetIdentityReason: 'accepted_assertion',
              matchedAmount: '10',
              proposalUniqueness: 'unique_pair',
              timeDirection: 'source_before_target',
              timeDistanceSeconds: 30,
            },
            reviewId: 'lp_test_1',
            reviewedAllocations: [
              {
                allocationSide: 'source',
                assetId: 'exchange:kraken:eth',
                assetSymbol: 'ETH',
                journalFingerprint: 'ledger_journal:v1:source',
                postingFingerprint: 'ledger_posting:v1:source',
                quantity: '10',
                sourceActivityFingerprint: 'source_activity:v1:source',
              },
              {
                allocationSide: 'target',
                assetId: 'blockchain:ethereum:native',
                assetSymbol: 'ETH',
                journalFingerprint: 'ledger_journal:v1:target',
                postingFingerprint: 'ledger_posting:v1:target',
                quantity: '10',
                sourceActivityFingerprint: 'source_activity:v1:target',
              },
            ],
          },
          recognitionStrategy: LEDGER_REVIEWED_RELATIONSHIP_STRATEGY,
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

  it('supports unequal allocation quantities for migration-style reviewed relationships', () => {
    const accepted = makeReviewedOverride({
      allocations: [
        makeReviewedAllocation('source', {
          assetId: 'exchange:kucoin:rndr',
          assetSymbol: RNDR,
          quantity: new Decimal(20),
        }),
        makeReviewedAllocation('target', {
          assetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
          assetSymbol: RENDER,
          quantity: new Decimal('19.5536'),
        }),
      ],
      evidence: {
        note: 'RNDR to RENDER migration reviewed by operator',
      },
      relationshipKind: 'asset_migration',
    });
    const result = buildLedgerReviewedRelationshipOverrides(
      [
        makeCandidate('source', { amount: new Decimal(20), assetId: 'exchange:kucoin:rndr', assetSymbol: RNDR }),
        makeCandidate('target', {
          amount: new Decimal('19.5536'),
          assetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
          assetSymbol: RENDER,
        }),
      ],
      [accepted]
    );

    expect(assertOk(result).relationships[0]?.relationshipKind).toBe('asset_migration');
  });
});

function makeReviewedOverride(
  overrides: Partial<LedgerLinkingReviewedRelationshipOverride> = {}
): LedgerLinkingReviewedRelationshipOverride {
  return {
    acceptedAt: '2026-04-29T00:00:00.000Z',
    allocations: [makeReviewedAllocation('source'), makeReviewedAllocation('target')],
    evidence: {
      assetIdentityReason: 'accepted_assertion',
      matchedAmount: '10',
      proposalUniqueness: 'unique_pair',
      timeDirection: 'source_before_target',
      timeDistanceSeconds: 30,
    },
    overrideEventId: 'override-event-1',
    proposalKind: 'amount_time',
    relationshipKind: 'internal_transfer',
    reviewId: 'lp_test_1',
    ...overrides,
  };
}

function makeReviewedAllocation(
  side: 'source' | 'target',
  overrides: Partial<LedgerLinkingReviewedRelationshipOverride['allocations'][number]> = {}
): LedgerLinkingReviewedRelationshipOverride['allocations'][number] {
  return {
    allocationSide: side,
    assetId: side === 'source' ? 'exchange:kraken:eth' : 'blockchain:ethereum:native',
    assetSymbol: ETH,
    journalFingerprint: side === 'source' ? 'ledger_journal:v1:source' : 'ledger_journal:v1:target',
    postingFingerprint: side === 'source' ? 'ledger_posting:v1:source' : 'ledger_posting:v1:target',
    quantity: new Decimal(10),
    sourceActivityFingerprint: side === 'source' ? 'source_activity:v1:source' : 'source_activity:v1:target',
    ...overrides,
  };
}

function makeCandidate(
  direction: 'source' | 'target',
  overrides: Partial<LedgerTransferLinkingCandidate> = {}
): LedgerTransferLinkingCandidate {
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
    ...overrides,
  };
}
