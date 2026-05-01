import { parseCurrency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { LedgerLinkingAssetIdentitySuggestion } from '../../asset-identity/asset-identity-suggestions.js';
import type {
  LedgerLinkingAmountTimeProposal,
  LedgerLinkingAssetMigrationProposal,
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnostics,
} from '../../diagnostics/linking-diagnostics.js';
import { buildLedgerLinkingReviewQueue } from '../linking-review.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('buildLedgerLinkingReviewQueue', () => {
  it('combines asset identity suggestions and link proposals into stable review items', () => {
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [makeAssetIdentitySuggestion()],
      diagnostics: makeDiagnostics([makeAmountTimeProposal()]),
    });

    expect(queue.itemCount).toBe(2);
    expect(queue.assetIdentitySuggestionCount).toBe(1);
    expect(queue.gapResolutionCount).toBe(0);
    expect(queue.linkProposalCount).toBe(1);
    expect(queue.items.map((item) => item.kind)).toEqual(['asset_identity_suggestion', 'link_proposal']);

    const assetIdentityItem = queue.items[0];
    expect(assetIdentityItem?.reviewId).toMatch(/^ai_[a-f0-9]{12}$/);
    expect(assetIdentityItem).toMatchObject({
      evidenceStrength: 'strong',
      kind: 'asset_identity_suggestion',
    });

    const linkProposalItem = queue.items[1];
    expect(linkProposalItem?.reviewId).toMatch(/^lp_[a-f0-9]{12}$/);
    expect(linkProposalItem).toMatchObject({
      evidenceStrength: 'medium',
      kind: 'link_proposal',
      proposalKind: 'amount_time',
      relationshipKind: 'internal_transfer',
    });
  });

  it('keeps asset identity review ids stable when only examples change', () => {
    const firstQueue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [makeAssetIdentitySuggestion({ blockCount: 1 })],
    });
    const secondQueue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [
        makeAssetIdentitySuggestion({
          blockCount: 9,
          examples: [
            {
              amount: '2',
              sourcePostingFingerprint: 'ledger_posting:v1:other-source',
              targetPostingFingerprint: 'ledger_posting:v1:other-target',
            },
          ],
        }),
      ],
    });

    expect(firstQueue.items[0]?.reviewId).toBe(secondQueue.items[0]?.reviewId);
  });

  it('marks ambiguous amount/time proposals as weak review evidence', () => {
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [],
      diagnostics: makeDiagnostics([
        makeAmountTimeProposal({
          source: makeRemainder({
            candidateId: 9,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:ambiguous-source',
          }),
          uniqueness: 'ambiguous_source',
        }),
      ]),
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      evidenceStrength: 'weak',
      kind: 'link_proposal',
    });
  });

  it('does not expose target-before-source amount/time proposals as acceptable review items', () => {
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [],
      diagnostics: makeDiagnostics([
        makeAmountTimeProposal({
          timeDirection: 'target_before_source',
        }),
      ]),
    });

    expect(queue.itemCount).toBe(0);
    expect(queue.gapResolutionCount).toBe(0);
    expect(queue.linkProposalCount).toBe(0);
    expect(queue.items).toEqual([]);
  });

  it('classifies bridge-diagnostic amount/time proposals as bridge link proposals', () => {
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [],
      diagnostics: makeDiagnostics([
        makeAmountTimeProposal({
          source: makeRemainder({
            candidateId: 11,
            direction: 'source',
            journalDiagnosticCodes: ['bridge_transfer'],
            platformKey: 'ethereum',
            platformKind: 'blockchain',
            postingFingerprint: 'ledger_posting:v1:bridge-source',
          }),
          target: makeRemainder({
            candidateId: 12,
            direction: 'target',
            journalDiagnosticCodes: ['bridge_transfer'],
            platformKey: 'solana',
            platformKind: 'blockchain',
            postingFingerprint: 'ledger_posting:v1:bridge-target',
          }),
        }),
      ]),
    });

    expect(queue.itemCount).toBe(1);
    expect(queue.items[0]).toMatchObject({
      kind: 'link_proposal',
      proposalKind: 'bridge_amount_time',
      relationshipKind: 'bridge',
    });
  });

  it('adds asset-migration proposals as reviewed asset-migration link proposals', () => {
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [],
      diagnostics: makeDiagnostics([], {
        assetMigrationProposals: [
          makeAssetMigrationProposal({
            evidence: 'same_hash_symbol_migration',
          }),
        ],
      }),
    });

    expect(queue.itemCount).toBe(1);
    expect(queue.items[0]).toMatchObject({
      evidenceStrength: 'strong',
      kind: 'link_proposal',
      proposalKind: 'asset_migration_same_hash',
      relationshipKind: 'asset_migration',
    });
  });

  it('adds safe gap resolution review items and filters already accepted resolution keys', () => {
    const residual = makeRemainder({
      candidateId: 21,
      direction: 'source',
      postingFingerprint: 'ledger_posting:v1:residual',
      claimedAmount: '1.25',
      remainingAmount: '0.01',
    });
    const spam = makeRemainder({
      candidateId: 22,
      direction: 'target',
      postingFingerprint: 'ledger_posting:v1:spam',
    });
    const queue = buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: [],
      diagnostics: makeDiagnostics([], {
        candidateClassifications: [
          {
            candidateId: 21,
            classifications: ['external_transfer_evidence'],
            direction: 'source',
            platformKey: 'kraken',
          },
          {
            candidateId: 22,
            classifications: ['likely_spam_airdrop'],
            direction: 'target',
            platformKey: 'ethereum',
          },
        ],
        unmatchedCandidates: [residual, spam],
      }),
      resolvedGapResolutionKeys: new Set(['ledger_linking_v2:ledger_posting:v1:spam']),
    });

    expect(queue.itemCount).toBe(1);
    expect(queue.gapResolutionCount).toBe(1);
    expect(queue.items[0]).toMatchObject({
      evidenceStrength: 'strong',
      kind: 'gap_resolution',
      resolution: {
        resolutionKind: 'accepted_transfer_residual',
        resolutionKey: 'ledger_linking_v2:ledger_posting:v1:residual',
      },
    });
    expect(queue.items[0]?.reviewId).toMatch(/^gr_[a-f0-9]{12}$/);
  });
});

function makeAssetIdentitySuggestion(
  overrides: Partial<LedgerLinkingAssetIdentitySuggestion> = {}
): LedgerLinkingAssetIdentitySuggestion {
  return {
    assetIdA: 'blockchain:ethereum:native',
    assetIdB: 'exchange:kraken:eth',
    assetSymbol: ETH,
    blockCount: 1,
    evidenceKind: 'exact_hash_observed',
    examples: [
      {
        amount: '1',
        sourcePostingFingerprint: 'ledger_posting:v1:source',
        targetPostingFingerprint: 'ledger_posting:v1:target',
      },
    ],
    relationshipKind: 'internal_transfer',
    ...overrides,
  };
}

function makeDiagnostics(
  proposals: readonly LedgerLinkingAmountTimeProposal[],
  overrides: Partial<
    Pick<LedgerLinkingDiagnostics, 'assetMigrationProposals' | 'candidateClassifications' | 'unmatchedCandidates'>
  > = {}
): LedgerLinkingDiagnostics {
  return {
    assetIdentityBlockerProposalCount: 0,
    assetIdentityBlockerProposals: [],
    assetMigrationProposalCount: overrides.assetMigrationProposals?.length ?? 0,
    assetMigrationProposals: overrides.assetMigrationProposals ?? [],
    assetMigrationUniqueProposalCount:
      overrides.assetMigrationProposals?.filter((proposal) => proposal.uniqueness === 'unique_pair').length ?? 0,
    amountTimeProposalCount: proposals.length,
    amountTimeProposalGroups: [],
    amountTimeProposals: proposals,
    amountTimeUniqueProposalCount: proposals.filter((proposal) => proposal.uniqueness === 'unique_pair').length,
    amountTimeWindowMinutes: 1440,
    candidateClassificationGroups: [],
    candidateClassifications: overrides.candidateClassifications ?? [],
    unmatchedCandidateGroups: [],
    unmatchedCandidates: overrides.unmatchedCandidates ?? [],
  };
}

function makeAmountTimeProposal(
  overrides: Partial<LedgerLinkingAmountTimeProposal> = {}
): LedgerLinkingAmountTimeProposal {
  return {
    amount: '1',
    assetIdentityReason: 'accepted_assertion',
    assetSymbol: ETH,
    source: makeRemainder({
      candidateId: 7,
      direction: 'source',
      postingFingerprint: 'ledger_posting:v1:source',
    }),
    sourceQuantity: '1',
    target: makeRemainder({
      candidateId: 8,
      direction: 'target',
      postingFingerprint: 'ledger_posting:v1:target',
    }),
    targetQuantity: '1',
    timeDirection: 'source_before_target',
    timeDistanceSeconds: 1800,
    uniqueness: 'unique_pair',
    ...overrides,
  };
}

function makeAssetMigrationProposal(
  overrides: Partial<LedgerLinkingAssetMigrationProposal> = {}
): LedgerLinkingAssetMigrationProposal {
  return {
    evidence: 'processor_context_approximate_amount',
    source: makeRemainder({
      assetId: 'exchange:kraken:rndr',
      assetSymbol: 'RNDR',
      candidateId: 31,
      direction: 'source',
      journalDiagnosticCodes: ['possible_asset_migration'],
      platformKey: 'kraken',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:migration-source',
      remainingAmount: '64.98757287',
    }),
    sourceQuantity: '64.98757287',
    target: makeRemainder({
      assetId: 'exchange:kraken:render',
      assetSymbol: 'RENDER',
      candidateId: 32,
      direction: 'target',
      journalDiagnosticCodes: ['possible_asset_migration'],
      platformKey: 'kraken',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:migration-target',
      remainingAmount: '64.987572',
    }),
    targetQuantity: '64.987572',
    timeDirection: 'target_before_source',
    timeDistanceSeconds: 777906,
    uniqueness: 'unique_pair',
    ...overrides,
  };
}

function makeRemainder(overrides: {
  assetId?: string | undefined;
  assetSymbol?: string | undefined;
  candidateId: number;
  claimedAmount?: string | undefined;
  direction: 'source' | 'target';
  journalDiagnosticCodes?: readonly string[] | undefined;
  platformKey?: string | undefined;
  platformKind?: 'exchange' | 'blockchain' | undefined;
  postingFingerprint: string;
  remainingAmount?: string | undefined;
}): LedgerLinkingCandidateRemainder {
  const defaultPlatformKind = overrides.direction === 'source' ? 'exchange' : 'blockchain';

  return {
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    assetId:
      overrides.assetId ?? (overrides.direction === 'source' ? 'exchange:kraken:eth' : 'blockchain:ethereum:native'),
    assetSymbol: overrides.assetSymbol === undefined ? ETH : assertOk(parseCurrency(overrides.assetSymbol)),
    blockchainTransactionHash: undefined,
    candidateId: overrides.candidateId,
    claimedAmount: overrides.claimedAmount ?? '0',
    direction: overrides.direction,
    fromAddress: undefined,
    journalFingerprint: `ledger_journal:v1:${overrides.candidateId}`,
    journalDiagnosticCodes: overrides.journalDiagnosticCodes ?? [],
    originalAmount: '1',
    ownerAccountId: overrides.direction === 'source' ? 1 : 2,
    platformKey: overrides.platformKey ?? (overrides.direction === 'source' ? 'kraken' : 'ethereum'),
    platformKind: overrides.platformKind ?? defaultPlatformKind,
    postingFingerprint: overrides.postingFingerprint,
    remainingAmount: overrides.remainingAmount ?? '1',
    sourceActivityFingerprint: `source_activity:v1:${overrides.candidateId}`,
    toAddress: undefined,
  };
}
