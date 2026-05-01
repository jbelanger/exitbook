import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildLedgerLinkingAssetIdentityResolver,
  type LedgerLinkingAssetIdentityAssertion,
} from '../../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../../candidates/candidate-construction.js';
import { buildLedgerLinkingDiagnostics } from '../linking-diagnostics.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('buildLedgerLinkingDiagnostics', () => {
  it('builds quantity-aware unmatched remainders and exact amount/time proposals', () => {
    const resolver = assertOk(
      buildLedgerLinkingAssetIdentityResolver([makeAssertion('exchange:kraken:eth', 'blockchain:ethereum:native')])
    );
    const sourceCandidate = makeCandidate({
      amount: '3',
      assetId: 'exchange:kraken:eth',
      candidateId: 1,
      direction: 'source',
      platformKey: 'kraken',
    });
    const targetCandidate = makeCandidate({
      amount: '2',
      assetId: 'blockchain:ethereum:native',
      candidateId: 2,
      direction: 'target',
      platformKey: 'ethereum',
      activityDatetime: new Date('2026-04-23T00:30:00.000Z'),
    });
    const unrelatedSource = makeCandidate({
      amount: '0.5',
      assetId: 'exchange:kraken:eth',
      candidateId: 3,
      direction: 'source',
      platformKey: 'kraken',
      activityDatetime: new Date('2026-04-23T01:00:00.000Z'),
    });

    const result = assertOk(
      buildLedgerLinkingDiagnostics(
        [sourceCandidate, targetCandidate, unrelatedSource],
        [{ candidateId: 1, quantity: new Decimal(1) }],
        resolver,
        { amountTimeWindowMinutes: 60 }
      )
    );

    expect(result.unmatchedCandidates.map(toRemainderSummary)).toEqual([
      {
        candidateId: 1,
        claimedAmount: '1',
        direction: 'source',
        originalAmount: '3',
        platformKey: 'kraken',
        remainingAmount: '2',
      },
      {
        candidateId: 3,
        claimedAmount: '0',
        direction: 'source',
        originalAmount: '0.5',
        platformKey: 'kraken',
        remainingAmount: '0.5',
      },
      {
        candidateId: 2,
        claimedAmount: '0',
        direction: 'target',
        originalAmount: '2',
        platformKey: 'ethereum',
        remainingAmount: '2',
      },
    ]);
    expect(result.unmatchedCandidateGroups.map(toGroupSummary)).toEqual([
      {
        assetId: 'exchange:kraken:eth',
        candidateCount: 2,
        direction: 'source',
        platformKey: 'kraken',
        remainingAmountTotal: '2.5',
      },
      {
        assetId: 'blockchain:ethereum:native',
        candidateCount: 1,
        direction: 'target',
        platformKey: 'ethereum',
        remainingAmountTotal: '2',
      },
    ]);
    expect(result.amountTimeProposalCount).toBe(1);
    expect(result.amountTimeUniqueProposalCount).toBe(1);
    expect(result.amountTimeProposals.map(toProposalSummary)).toEqual([
      {
        amount: '2',
        assetIdentityReason: 'accepted_assertion',
        sourceCandidateId: 1,
        targetCandidateId: 2,
        timeDirection: 'source_before_target',
        timeDistanceSeconds: 1800,
        uniqueness: 'unique_pair',
      },
    ]);
    expect(result.candidateClassificationGroups).toEqual([
      {
        candidateCount: 2,
        classification: 'amount_time_unique',
        sourceCandidateCount: 1,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 1,
        classification: 'external_transfer_evidence',
        sourceCandidateCount: 1,
        targetCandidateCount: 0,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('remainingAmountDecimal');
  });

  it('marks amount/time proposal ambiguity before anything can become durable truth', () => {
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver());
    const result = assertOk(
      buildLedgerLinkingDiagnostics(
        [
          makeCandidate({ candidateId: 1, direction: 'source', amount: '1' }),
          makeCandidate({
            candidateId: 2,
            direction: 'target',
            amount: '1',
            activityDatetime: new Date('2026-04-23T00:10:00.000Z'),
          }),
          makeCandidate({
            candidateId: 3,
            direction: 'target',
            amount: '1',
            activityDatetime: new Date('2026-04-23T00:20:00.000Z'),
          }),
        ],
        [],
        resolver,
        { amountTimeWindowMinutes: 60 }
      )
    );

    expect(result.amountTimeProposalCount).toBe(2);
    expect(result.amountTimeUniqueProposalCount).toBe(0);
    expect(result.amountTimeProposals.map((proposal) => proposal.uniqueness)).toEqual([
      'ambiguous_source',
      'ambiguous_source',
    ]);
    expect(result.amountTimeProposalGroups).toEqual([
      {
        amount: '1',
        ambiguousProposalCount: 2,
        assetSymbol: ETH,
        maxTimeDistanceSeconds: 1200,
        minTimeDistanceSeconds: 600,
        proposalCount: 2,
        sourcePlatformKey: 'ethereum',
        sourcePlatformKind: 'blockchain',
        targetPlatformKey: 'ethereum',
        targetPlatformKind: 'blockchain',
        uniqueProposalCount: 0,
      },
    ]);
    expect(result.candidateClassificationGroups).toEqual([
      {
        candidateCount: 3,
        classification: 'amount_time_ambiguous',
        sourceCandidateCount: 1,
        targetCandidateCount: 2,
      },
    ]);
  });

  it('classifies blocked identities, missing evidence, fiat cash movements, same-account roundtrips, and spam targets', () => {
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver());
    const result = assertOk(
      buildLedgerLinkingDiagnostics(
        [
          makeCandidate({
            amount: '1',
            assetId: 'exchange:kraken:eth',
            blockchainTransactionHash: undefined,
            candidateId: 1,
            direction: 'source',
            fromAddress: undefined,
            platformKey: 'kraken',
            platformKind: 'exchange',
            toAddress: undefined,
          }),
          makeCandidate({
            amount: '1',
            assetId: 'blockchain:ethereum:native',
            candidateId: 2,
            direction: 'target',
            platformKey: 'ethereum',
          }),
          makeCandidate({
            amount: '5',
            assetSymbol: 'AIRDROP',
            candidateId: 3,
            direction: 'target',
            platformKey: 'arbitrum',
          }),
          makeCandidate({
            amount: '500',
            assetId: 'exchange:kraken:cad',
            assetSymbol: 'CAD',
            blockchainTransactionHash: undefined,
            candidateId: 6,
            direction: 'target',
            fromAddress: undefined,
            platformKey: 'kraken',
            platformKind: 'exchange',
            toAddress: undefined,
          }),
          makeCandidate({
            amount: '1',
            assetId: 'blockchain:ethereum:0x0f49943d89e7417522107f6e824c30aad487e6c0',
            assetSymbol: 'SP',
            candidateId: 7,
            direction: 'target',
            fromAddress: '0x0f49943d89e7417522107f6e824c30aad487e6c0',
            platformKey: 'ethereum',
            toAddress: '0xself',
          }),
          makeCandidate({
            amount: '0.000000001',
            assetId: 'blockchain:solana:native',
            assetSymbol: 'SOL',
            candidateId: 8,
            direction: 'target',
            platformKey: 'solana',
          }),
          makeCandidate({
            amount: '64.987572',
            assetId: 'exchange:kraken:render',
            assetSymbol: 'RENDER',
            blockchainTransactionHash: undefined,
            candidateId: 9,
            direction: 'target',
            fromAddress: undefined,
            journalDiagnosticCodes: ['possible_asset_migration'],
            platformKey: 'kraken',
            platformKind: 'exchange',
            toAddress: undefined,
          }),
          makeCandidate({
            amount: '0.5',
            candidateId: 4,
            direction: 'source',
            fromAddress: '0xself',
            ownerAccountId: 11,
            platformKey: 'ethereum',
            toAddress: '0xcounterparty',
          }),
          makeCandidate({
            amount: '0.5',
            activityDatetime: new Date('2026-04-25T00:00:00.000Z'),
            candidateId: 5,
            direction: 'target',
            fromAddress: '0xcounterparty',
            ownerAccountId: 11,
            platformKey: 'ethereum',
            toAddress: '0xself',
          }),
        ],
        [],
        resolver,
        { amountTimeWindowMinutes: 60 }
      )
    );

    expect([...result.candidateClassifications].sort(compareClassificationsByCandidateId)).toEqual([
      {
        candidateId: 1,
        classifications: ['asset_identity_blocked', 'exchange_transfer_missing_hash', 'missing_linking_evidence'],
        direction: 'source',
        platformKey: 'kraken',
      },
      {
        candidateId: 2,
        classifications: ['asset_identity_blocked'],
        direction: 'target',
        platformKey: 'ethereum',
      },
      {
        candidateId: 3,
        classifications: ['likely_spam_airdrop'],
        direction: 'target',
        platformKey: 'arbitrum',
      },
      {
        candidateId: 4,
        classifications: ['same_account_roundtrip_candidate'],
        direction: 'source',
        platformKey: 'ethereum',
      },
      {
        candidateId: 5,
        classifications: ['same_account_roundtrip_candidate'],
        direction: 'target',
        platformKey: 'ethereum',
      },
      {
        candidateId: 6,
        classifications: ['fiat_cash_movement', 'missing_linking_evidence'],
        direction: 'target',
        platformKey: 'kraken',
      },
      {
        candidateId: 7,
        classifications: ['likely_spam_airdrop'],
        direction: 'target',
        platformKey: 'ethereum',
      },
      {
        candidateId: 8,
        classifications: ['likely_dust_airdrop'],
        direction: 'target',
        platformKey: 'solana',
      },
      {
        candidateId: 9,
        classifications: ['processor_asset_migration_context'],
        direction: 'target',
        platformKey: 'kraken',
      },
    ]);
    expect(result.assetIdentityBlockerProposals).toEqual([
      {
        amount: '1',
        assetSymbol: ETH,
        reason: 'same_symbol_different_asset_ids',
        source: result.unmatchedCandidates.find((candidate) => candidate.candidateId === 1),
        target: result.unmatchedCandidates.find((candidate) => candidate.candidateId === 2),
        timeDirection: 'same_time',
        timeDistanceSeconds: 0,
      },
    ]);
    expect(result.candidateClassificationGroups).toEqual([
      {
        candidateCount: 2,
        classification: 'asset_identity_blocked',
        sourceCandidateCount: 1,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 2,
        classification: 'likely_spam_airdrop',
        sourceCandidateCount: 0,
        targetCandidateCount: 2,
      },
      {
        candidateCount: 2,
        classification: 'missing_linking_evidence',
        sourceCandidateCount: 1,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 2,
        classification: 'same_account_roundtrip_candidate',
        sourceCandidateCount: 1,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 1,
        classification: 'exchange_transfer_missing_hash',
        sourceCandidateCount: 1,
        targetCandidateCount: 0,
      },
      {
        candidateCount: 1,
        classification: 'fiat_cash_movement',
        sourceCandidateCount: 0,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 1,
        classification: 'likely_dust_airdrop',
        sourceCandidateCount: 0,
        targetCandidateCount: 1,
      },
      {
        candidateCount: 1,
        classification: 'processor_asset_migration_context',
        sourceCandidateCount: 0,
        targetCandidateCount: 1,
      },
    ]);
  });

  it('builds allocation-aware asset migration proposals from same-hash and processor evidence', () => {
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver());
    const result = assertOk(
      buildLedgerLinkingDiagnostics(
        [
          makeCandidate({
            amount: '19.5536',
            assetId: 'exchange:kucoin:rndr',
            assetSymbol: 'RNDR',
            blockchainTransactionHash: '0x170983ad',
            candidateId: 11,
            direction: 'source',
            platformKey: 'kucoin',
            platformKind: 'exchange',
          }),
          makeCandidate({
            amount: '19.5536',
            activityDatetime: new Date('2026-04-23T00:01:00.000Z'),
            assetId: 'blockchain:ethereum:render',
            assetSymbol: 'RENDER',
            blockchainTransactionHash: '0x170983ad',
            candidateId: 12,
            direction: 'target',
            platformKey: 'ethereum',
            platformKind: 'blockchain',
          }),
          makeCandidate({
            amount: '64.98757287',
            activityDatetime: new Date('2026-04-25T00:00:00.000Z'),
            assetId: 'exchange:kraken:rndr',
            assetSymbol: 'RNDR',
            blockchainTransactionHash: undefined,
            candidateId: 13,
            direction: 'source',
            fromAddress: undefined,
            journalDiagnosticCodes: ['possible_asset_migration'],
            platformKey: 'kraken',
            platformKind: 'exchange',
            toAddress: undefined,
          }),
          makeCandidate({
            amount: '64.987572',
            activityDatetime: new Date('2026-04-16T00:00:00.000Z'),
            assetId: 'exchange:kraken:render',
            assetSymbol: 'RENDER',
            blockchainTransactionHash: undefined,
            candidateId: 14,
            direction: 'target',
            fromAddress: undefined,
            journalDiagnosticCodes: ['possible_asset_migration'],
            platformKey: 'kraken',
            platformKind: 'exchange',
            toAddress: undefined,
          }),
        ],
        [],
        resolver,
        { amountTimeWindowMinutes: 60 }
      )
    );

    expect(result.assetMigrationProposalCount).toBe(2);
    expect(result.assetMigrationUniqueProposalCount).toBe(2);
    expect(result.assetMigrationProposals.map(toAssetMigrationProposalSummary)).toEqual([
      {
        evidence: 'same_hash_symbol_migration',
        sourceCandidateId: 11,
        sourceQuantity: '19.5536',
        targetCandidateId: 12,
        targetQuantity: '19.5536',
        timeDirection: 'source_before_target',
        uniqueness: 'unique_pair',
      },
      {
        evidence: 'processor_context_approximate_amount',
        sourceCandidateId: 13,
        sourceQuantity: '64.98757287',
        targetCandidateId: 14,
        targetQuantity: '64.987572',
        timeDirection: 'target_before_source',
        uniqueness: 'unique_pair',
      },
    ]);
  });

  it('rejects overclaimed candidates', () => {
    const resolver = assertOk(buildLedgerLinkingAssetIdentityResolver());
    const result = buildLedgerLinkingDiagnostics(
      [makeCandidate({ amount: '1', candidateId: 1 })],
      [{ candidateId: 1, quantity: new Decimal(2) }],
      resolver
    );

    expect(assertErr(result).message).toContain('overclaimed candidate 1');
  });
});

function makeAssertion(assetIdA: string, assetIdB: string): LedgerLinkingAssetIdentityAssertion {
  return {
    assetIdA,
    assetIdB,
    evidenceKind: 'manual',
    relationshipKind: 'internal_transfer',
  };
}

function makeCandidate(
  overrides: Partial<Omit<LedgerTransferLinkingCandidate, 'amount' | 'assetSymbol'>> & {
    amount?: string | undefined;
    assetSymbol?: string | undefined;
  }
): LedgerTransferLinkingCandidate {
  const { amount, assetSymbol, ...candidateOverrides } = overrides;

  return {
    candidateId: 1,
    ownerAccountId: 1,
    sourceActivityFingerprint: 'source_activity:v1:source',
    journalFingerprint: 'ledger_journal:v1:source',
    postingFingerprint: `ledger_posting:v1:${overrides.candidateId ?? 1}`,
    direction: 'source',
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    blockchainTransactionHash: '0xabc',
    fromAddress: '0xfrom',
    toAddress: '0xto',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: assetSymbol === undefined ? ETH : assertOk(parseCurrency(assetSymbol)),
    amount: parseDecimal(amount ?? '1'),
    ...candidateOverrides,
  };
}

function toRemainderSummary(candidate: {
  candidateId: number;
  claimedAmount: string;
  direction: string;
  originalAmount: string;
  platformKey: string;
  remainingAmount: string;
}) {
  return {
    candidateId: candidate.candidateId,
    claimedAmount: candidate.claimedAmount,
    direction: candidate.direction,
    originalAmount: candidate.originalAmount,
    platformKey: candidate.platformKey,
    remainingAmount: candidate.remainingAmount,
  };
}

function toGroupSummary(group: {
  assetId: string;
  candidateCount: number;
  direction: string;
  platformKey: string;
  remainingAmountTotal: string;
}) {
  return {
    assetId: group.assetId,
    candidateCount: group.candidateCount,
    direction: group.direction,
    platformKey: group.platformKey,
    remainingAmountTotal: group.remainingAmountTotal,
  };
}

function toProposalSummary(proposal: {
  amount: string;
  assetIdentityReason: string;
  source: { candidateId: number };
  target: { candidateId: number };
  timeDirection: string;
  timeDistanceSeconds: number;
  uniqueness: string;
}) {
  return {
    amount: proposal.amount,
    assetIdentityReason: proposal.assetIdentityReason,
    sourceCandidateId: proposal.source.candidateId,
    targetCandidateId: proposal.target.candidateId,
    timeDirection: proposal.timeDirection,
    timeDistanceSeconds: proposal.timeDistanceSeconds,
    uniqueness: proposal.uniqueness,
  };
}

function toAssetMigrationProposalSummary(proposal: {
  evidence: string;
  source: { candidateId: number };
  sourceQuantity: string;
  target: { candidateId: number };
  targetQuantity: string;
  timeDirection: string;
  uniqueness: string;
}) {
  return {
    evidence: proposal.evidence,
    sourceCandidateId: proposal.source.candidateId,
    sourceQuantity: proposal.sourceQuantity,
    targetCandidateId: proposal.target.candidateId,
    targetQuantity: proposal.targetQuantity,
    timeDirection: proposal.timeDirection,
    uniqueness: proposal.uniqueness,
  };
}

function compareClassificationsByCandidateId(left: { candidateId: number }, right: { candidateId: number }): number {
  return left.candidateId - right.candidateId;
}
