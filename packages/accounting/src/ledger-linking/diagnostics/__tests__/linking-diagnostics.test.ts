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
  }
): LedgerTransferLinkingCandidate {
  const { amount, ...candidateOverrides } = overrides;

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
    assetSymbol: ETH,
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
