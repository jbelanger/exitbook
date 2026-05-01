import { parseCurrency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type {
  LedgerLinkingAmountTimeProposal,
  LedgerLinkingCandidateClassification,
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnostics,
} from '../../diagnostics/linking-diagnostics.js';
import {
  buildLedgerLinkingGapIssues,
  buildLedgerLinkingGapIssueKey,
  buildLedgerLinkingGapRef,
} from '../ledger-linking-gap-issues.js';

const ETH = assertOk(parseCurrency('ETH'));

describe('buildLedgerLinkingGapIssues', () => {
  it('turns unmatched diagnostic candidates into stable ledger-linking gap issues', () => {
    const source = makeCandidate({
      candidateId: 7,
      direction: 'source',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:source',
    });
    const target = makeCandidate({
      candidateId: 8,
      direction: 'target',
      postingFingerprint: 'ledger_posting:v1:target',
    });
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [source, target],
        classifications: [
          {
            candidateId: 7,
            classifications: ['exchange_transfer_missing_hash', 'missing_linking_evidence'],
            direction: 'source',
            platformKey: 'kraken',
          },
          {
            candidateId: 8,
            classifications: ['unclassified'],
            direction: 'target',
            platformKey: 'ethereum',
          },
        ],
      })
    );

    expect(issues.map((issue) => [issue.postingFingerprint, issue.gapReason])).toEqual([
      ['ledger_posting:v1:source', 'exchange_transfer_missing_hash'],
      ['ledger_posting:v1:target', 'unclassified_unmatched_transfer_candidate'],
    ]);
    expect(buildLedgerLinkingGapIssueKey(issues[0]!)).toBe('ledger_linking_v2:ledger_posting:v1:source');
    expect(buildLedgerLinkingGapRef(issues[0]!)).toMatch(/^[a-f0-9]{10}$/);
  });

  it('classifies missing exchange hash gaps with exact related-profile counterpart evidence separately', () => {
    const source = makeCandidate({
      candidateId: 7,
      direction: 'source',
      platformKind: 'exchange',
      postingFingerprint: 'ledger_posting:v1:source',
    });
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [source],
        classifications: [
          {
            candidateId: 7,
            classifications: ['exchange_transfer_missing_hash', 'missing_linking_evidence'],
            direction: 'source',
            platformKey: 'kraken',
          },
        ],
      }),
      {
        crossProfileCounterpartsByCandidateId: new Map([
          [
            7,
            [
              {
                activityDatetime: new Date('2026-04-23T00:00:15.000Z'),
                amount: '1',
                candidateId: 88,
                direction: 'target',
                platformKey: 'solana',
                platformKind: 'blockchain',
                postingFingerprint: 'ledger_posting:v1:child-target',
                profileDisplayName: 'Child profile',
                profileKey: 'child',
                secondsDeltaFromGap: 15,
              },
            ],
          ],
        ]),
      }
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      gapReason: 'related_profile_counterpart_evidence',
      postingFingerprint: 'ledger_posting:v1:source',
      relatedProfileCounterparts: [
        {
          candidateId: 88,
          profileKey: 'child',
          secondsDeltaFromGap: 15,
        },
      ],
    });
  });

  it('keeps target-before-source amount/time proposals as timing-mismatch gap context', () => {
    const source = makeCandidate({
      candidateId: 7,
      direction: 'source',
      postingFingerprint: 'ledger_posting:v1:source',
    });
    const target = makeCandidate({
      candidateId: 8,
      direction: 'target',
      postingFingerprint: 'ledger_posting:v1:target',
    });
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [source, target],
        classifications: [
          {
            candidateId: 7,
            classifications: ['amount_time_unique'],
            direction: 'source',
            platformKey: 'ethereum',
          },
          {
            candidateId: 8,
            classifications: ['amount_time_unique'],
            direction: 'target',
            platformKey: 'ethereum',
          },
        ],
        proposals: [
          {
            amount: '1',
            assetIdentityReason: 'same_asset_id',
            assetSymbol: ETH,
            source,
            sourceQuantity: '1',
            target,
            targetQuantity: '1',
            timeDirection: 'target_before_source',
            timeDistanceSeconds: 120,
            uniqueness: 'unique_pair',
          },
        ],
      })
    );

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.gapReason === 'bridge_or_migration_timing_mismatch')).toBe(true);
    expect(issues[0]?.timingCounterpart).toMatchObject({
      candidateId: 8,
      postingFingerprint: 'ledger_posting:v1:target',
      timeDirection: 'target_before_source',
      timeDistanceSeconds: 120,
    });
  });

  it('surfaces external transfer evidence as an unmatched external-evidence gap', () => {
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [
          makeCandidate({
            candidateId: 11,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:external',
          }),
        ],
        classifications: [
          {
            candidateId: 11,
            classifications: ['external_transfer_evidence'],
            direction: 'source',
            platformKey: 'ethereum',
          },
        ],
      })
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.gapReason).toBe('external_transfer_evidence_unmatched');
  });

  it('omits candidates with accepted ledger-linking gap resolutions', () => {
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [
          makeCandidate({
            candidateId: 11,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:resolved',
          }),
          makeCandidate({
            candidateId: 12,
            direction: 'source',
            postingFingerprint: 'ledger_posting:v1:open',
          }),
        ],
        classifications: [
          {
            candidateId: 11,
            classifications: ['external_transfer_evidence'],
            direction: 'source',
            platformKey: 'ethereum',
          },
          {
            candidateId: 12,
            classifications: ['external_transfer_evidence'],
            direction: 'source',
            platformKey: 'ethereum',
          },
        ],
      }),
      {
        resolvedGapResolutionKeys: new Set(['ledger_linking_v2:ledger_posting:v1:resolved']),
      }
    );

    expect(issues.map((issue) => issue.postingFingerprint)).toEqual(['ledger_posting:v1:open']);
  });

  it('surfaces processor-marked asset migration context as a warning gap reason', () => {
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [
          makeCandidate({
            candidateId: 13,
            direction: 'target',
            journalDiagnosticCodes: ['possible_asset_migration'],
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:asset-migration',
          }),
        ],
        classifications: [
          {
            candidateId: 13,
            classifications: ['processor_asset_migration_context'],
            direction: 'target',
            platformKey: 'kraken',
          },
        ],
      })
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      gapReason: 'processor_asset_migration_context',
      journalDiagnosticCodes: ['possible_asset_migration'],
      postingFingerprint: 'ledger_posting:v1:asset-migration',
    });
  });

  it('omits non-link-work classifications from surfaced gap issues', () => {
    const issues = buildLedgerLinkingGapIssues(
      makeDiagnostics({
        candidates: [
          makeCandidate({ candidateId: 9, direction: 'target', postingFingerprint: 'ledger_posting:v1:spam' }),
          makeCandidate({
            candidateId: 10,
            direction: 'target',
            platformKind: 'exchange',
            postingFingerprint: 'ledger_posting:v1:fiat',
          }),
          makeCandidate({ candidateId: 12, direction: 'target', postingFingerprint: 'ledger_posting:v1:dust' }),
        ],
        classifications: [
          {
            candidateId: 9,
            classifications: ['likely_spam_airdrop'],
            direction: 'target',
            platformKey: 'ethereum',
          },
          {
            candidateId: 10,
            classifications: ['fiat_cash_movement', 'missing_linking_evidence'],
            direction: 'target',
            platformKey: 'kraken',
          },
          {
            candidateId: 12,
            classifications: ['likely_dust_airdrop'],
            direction: 'target',
            platformKey: 'solana',
          },
        ],
      })
    );

    expect(issues).toHaveLength(0);
  });
});

function makeDiagnostics(input: {
  candidates: readonly LedgerLinkingCandidateRemainder[];
  classifications: readonly LedgerLinkingCandidateClassification[];
  proposals?: readonly LedgerLinkingAmountTimeProposal[] | undefined;
}): LedgerLinkingDiagnostics {
  return {
    assetIdentityBlockerProposalCount: 0,
    assetIdentityBlockerProposals: [],
    assetMigrationProposalCount: 0,
    assetMigrationProposals: [],
    assetMigrationUniqueProposalCount: 0,
    amountTimeProposalCount: input.proposals?.length ?? 0,
    amountTimeProposalGroups: [],
    amountTimeProposals: input.proposals ?? [],
    amountTimeUniqueProposalCount:
      input.proposals?.filter((proposal) => proposal.uniqueness === 'unique_pair').length ?? 0,
    amountTimeWindowMinutes: 1440,
    candidateClassificationGroups: [],
    candidateClassifications: input.classifications,
    unmatchedCandidateGroups: [],
    unmatchedCandidates: input.candidates,
  };
}

function makeCandidate(overrides: {
  candidateId: number;
  direction: 'source' | 'target';
  journalDiagnosticCodes?: readonly string[] | undefined;
  platformKind?: 'blockchain' | 'exchange' | undefined;
  postingFingerprint: string;
}): LedgerLinkingCandidateRemainder {
  return {
    activityDatetime: new Date('2026-04-23T00:00:00.000Z'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: ETH,
    blockchainTransactionHash: overrides.platformKind === 'exchange' ? undefined : '0xhash',
    candidateId: overrides.candidateId,
    claimedAmount: '0',
    direction: overrides.direction,
    fromAddress: undefined,
    journalFingerprint: `ledger_journal:v1:${overrides.candidateId}`,
    journalDiagnosticCodes: overrides.journalDiagnosticCodes ?? [],
    originalAmount: '1',
    ownerAccountId: 1,
    platformKey: overrides.platformKind === 'exchange' ? 'kraken' : 'ethereum',
    platformKind: overrides.platformKind ?? 'blockchain',
    postingFingerprint: overrides.postingFingerprint,
    remainingAmount: '1',
    sourceActivityFingerprint: `source_activity:v1:${overrides.candidateId}`,
    toAddress: undefined,
  };
}
