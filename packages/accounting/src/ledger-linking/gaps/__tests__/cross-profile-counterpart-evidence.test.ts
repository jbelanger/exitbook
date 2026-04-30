import { parseCurrency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type {
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnosticClassification,
  LedgerLinkingDiagnostics,
} from '../../diagnostics/linking-diagnostics.js';
import { buildLedgerLinkingCrossProfileCounterpartsByCandidateId } from '../cross-profile-counterpart-evidence.js';

const USDC = assertOk(parseCurrency('USDC'));

describe('buildLedgerLinkingCrossProfileCounterpartsByCandidateId', () => {
  it('matches exact opposite-direction amount/time evidence from another profile', () => {
    const activeCandidate = makeCandidate({
      candidateId: 1,
      direction: 'source',
      platformKey: 'kraken',
      remainingAmount: '99.000',
      timestamp: '2024-05-19T11:31:53.388Z',
    });
    const childCandidate = makeCandidate({
      candidateId: 2,
      direction: 'target',
      platformKey: 'solana',
      remainingAmount: '99',
      timestamp: '2024-05-19T11:32:08.000Z',
    });

    const counterpartsByCandidateId = buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
      makeDiagnostics([activeCandidate]),
      [
        {
          diagnostics: makeDiagnostics([childCandidate]),
          profileDisplayName: 'Maely',
          profileId: 2,
          profileKey: 'maely',
        },
      ],
      { windowSeconds: 60 }
    );

    expect(counterpartsByCandidateId.get(1)).toEqual([
      {
        activityDatetime: new Date('2024-05-19T11:32:08.000Z'),
        amount: '99',
        candidateId: 2,
        direction: 'target',
        platformKey: 'solana',
        platformKind: 'blockchain',
        postingFingerprint: 'ledger_posting:v1:2',
        profileDisplayName: 'Maely',
        profileKey: 'maely',
        secondsDeltaFromGap: 14.612,
      },
    ]);
  });

  it('does not match same-direction, different-amount, or outside-window candidates', () => {
    const activeCandidate = makeCandidate({
      candidateId: 1,
      direction: 'source',
      remainingAmount: '99',
      timestamp: '2024-05-19T11:31:53.388Z',
    });
    const sameDirection = makeCandidate({
      candidateId: 2,
      direction: 'source',
      remainingAmount: '99',
      timestamp: '2024-05-19T11:32:08.000Z',
    });
    const differentAmount = makeCandidate({
      candidateId: 3,
      direction: 'target',
      remainingAmount: '98.999',
      timestamp: '2024-05-19T11:32:08.000Z',
    });
    const outsideWindow = makeCandidate({
      candidateId: 4,
      direction: 'target',
      remainingAmount: '99',
      timestamp: '2024-05-19T12:32:08.000Z',
    });

    const counterpartsByCandidateId = buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
      makeDiagnostics([activeCandidate]),
      [
        {
          diagnostics: makeDiagnostics([sameDirection, differentAmount, outsideWindow]),
          profileDisplayName: 'Liam',
          profileId: 3,
          profileKey: 'liam',
        },
      ],
      { windowSeconds: 60 }
    );

    expect(counterpartsByCandidateId.has(1)).toBe(false);
  });

  it('ignores non-link-work counterpart candidates', () => {
    const activeCandidate = makeCandidate({
      candidateId: 1,
      direction: 'source',
      remainingAmount: '1',
      timestamp: '2024-05-19T11:31:53.388Z',
    });
    const spamCandidate = makeCandidate({
      candidateId: 2,
      direction: 'target',
      remainingAmount: '1',
      timestamp: '2024-05-19T11:32:08.000Z',
    });

    const counterpartsByCandidateId = buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
      makeDiagnostics([activeCandidate]),
      [
        {
          diagnostics: makeDiagnostics([spamCandidate], new Map([[2, ['likely_spam_airdrop']]])),
          profileDisplayName: 'Liam',
          profileId: 3,
          profileKey: 'liam',
        },
      ],
      { windowSeconds: 60 }
    );

    expect(counterpartsByCandidateId.has(1)).toBe(false);
  });

  it('returns the closest limited counterparts deterministically', () => {
    const activeCandidate = makeCandidate({
      candidateId: 1,
      direction: 'source',
      remainingAmount: '1',
      timestamp: '2024-05-19T11:31:53.000Z',
    });
    const laterCandidate = makeCandidate({
      candidateId: 2,
      direction: 'target',
      remainingAmount: '1',
      timestamp: '2024-05-19T11:32:08.000Z',
    });
    const closerCandidate = makeCandidate({
      candidateId: 3,
      direction: 'target',
      remainingAmount: '1',
      timestamp: '2024-05-19T11:31:58.000Z',
    });

    const counterpartsByCandidateId = buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
      makeDiagnostics([activeCandidate]),
      [
        {
          diagnostics: makeDiagnostics([laterCandidate]),
          profileDisplayName: 'Maely',
          profileId: 2,
          profileKey: 'maely',
        },
        {
          diagnostics: makeDiagnostics([closerCandidate]),
          profileDisplayName: 'Liam',
          profileId: 3,
          profileKey: 'liam',
        },
      ],
      { maxCounterparts: 1, windowSeconds: 60 }
    );

    expect(counterpartsByCandidateId.get(1)?.map((counterpart) => counterpart.candidateId)).toEqual([3]);
  });
});

function makeDiagnostics(
  candidates: readonly LedgerLinkingCandidateRemainder[],
  classificationsByCandidateId: ReadonlyMap<number, readonly LedgerLinkingDiagnosticClassification[]> = new Map()
): LedgerLinkingDiagnostics {
  return {
    assetIdentityBlockerProposalCount: 0,
    assetIdentityBlockerProposals: [],
    amountTimeProposalCount: 0,
    amountTimeProposalGroups: [],
    amountTimeProposals: [],
    amountTimeUniqueProposalCount: 0,
    amountTimeWindowMinutes: 1440,
    candidateClassificationGroups: [],
    candidateClassifications: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      classifications: classificationsByCandidateId.get(candidate.candidateId) ?? ['unclassified'],
      direction: candidate.direction,
      platformKey: candidate.platformKey,
    })),
    unmatchedCandidateGroups: [],
    unmatchedCandidates: candidates,
  };
}

function makeCandidate(overrides: {
  candidateId: number;
  direction: 'source' | 'target';
  platformKey?: string | undefined;
  remainingAmount: string;
  timestamp: string;
}): LedgerLinkingCandidateRemainder {
  return {
    activityDatetime: new Date(overrides.timestamp),
    assetId: 'blockchain:solana:usdc',
    assetSymbol: USDC,
    blockchainTransactionHash: 'solana-hash',
    candidateId: overrides.candidateId,
    claimedAmount: '0',
    direction: overrides.direction,
    fromAddress: undefined,
    journalFingerprint: `ledger_journal:v1:${overrides.candidateId}`,
    journalDiagnosticCodes: [],
    originalAmount: overrides.remainingAmount,
    ownerAccountId: overrides.candidateId,
    platformKey: overrides.platformKey ?? 'solana',
    platformKind: 'blockchain',
    postingFingerprint: `ledger_posting:v1:${overrides.candidateId}`,
    remainingAmount: overrides.remainingAmount,
    sourceActivityFingerprint: `source_activity:v1:${overrides.candidateId}`,
    toAddress: undefined,
  };
}
