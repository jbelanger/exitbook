import { CurrencySchema, DateSchema, sha256Hex } from '@exitbook/foundation';
import { z } from 'zod';

import {
  type LedgerLinkingAmountTimeProposal,
  type LedgerLinkingCandidateRemainder,
  type LedgerLinkingDiagnosticClassification,
  type LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';

export const LedgerLinkingGapReasonSchema = z.enum([
  'bridge_or_migration_timing_mismatch',
  'exchange_transfer_missing_hash',
  'external_transfer_evidence_unmatched',
  'missing_linking_evidence',
  'processor_asset_migration_context',
  'related_profile_counterpart_evidence',
  'unclassified_unmatched_transfer_candidate',
]);
export type LedgerLinkingGapReason = z.infer<typeof LedgerLinkingGapReasonSchema>;

export const LedgerLinkingGapCrossProfileCounterpartSchema = z.object({
  activityDatetime: DateSchema,
  amount: z.string().min(1),
  candidateId: z.number().int().positive(),
  direction: z.enum(['source', 'target']),
  platformKey: z.string().min(1),
  platformKind: z.enum(['exchange', 'blockchain']),
  postingFingerprint: z.string().min(1),
  profileDisplayName: z.string().min(1),
  profileKey: z.string().min(1),
  secondsDeltaFromGap: z.number(),
});
export type LedgerLinkingGapCrossProfileCounterpart = z.infer<typeof LedgerLinkingGapCrossProfileCounterpartSchema>;

export const LedgerLinkingGapCounterpartSchema = z.object({
  candidateId: z.number().int().positive(),
  direction: z.enum(['source', 'target']),
  postingFingerprint: z.string().min(1),
  timeDirection: z.enum(['source_before_target', 'target_before_source', 'same_time']),
  timeDistanceSeconds: z.number().nonnegative(),
});
export type LedgerLinkingGapCounterpart = z.infer<typeof LedgerLinkingGapCounterpartSchema>;

export const LedgerLinkingGapIssueSchema = z.object({
  activityDatetime: DateSchema,
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  blockchainTransactionHash: z.string().min(1).optional(),
  candidateId: z.number().int().positive(),
  classifications: z.array(z.string().min(1)),
  claimedAmount: z.string().min(1),
  direction: z.enum(['source', 'target']),
  fromAddress: z.string().min(1).optional(),
  gapReason: LedgerLinkingGapReasonSchema,
  journalFingerprint: z.string().min(1),
  journalDiagnosticCodes: z.array(z.string().min(1)).optional(),
  originalAmount: z.string().min(1),
  ownerAccountId: z.number().int().positive(),
  platformKey: z.string().min(1),
  platformKind: z.enum(['exchange', 'blockchain']),
  postingFingerprint: z.string().min(1),
  remainingAmount: z.string().min(1),
  relatedProfileCounterparts: z.array(LedgerLinkingGapCrossProfileCounterpartSchema).optional(),
  sourceActivityFingerprint: z.string().min(1),
  toAddress: z.string().min(1).optional(),
  timingCounterpart: LedgerLinkingGapCounterpartSchema.optional(),
});
export type LedgerLinkingGapIssue = z.infer<typeof LedgerLinkingGapIssueSchema>;

export interface LedgerLinkingGapIssueBuildOptions {
  crossProfileCounterpartsByCandidateId?:
    | ReadonlyMap<number, readonly LedgerLinkingGapCrossProfileCounterpart[]>
    | undefined;
}

interface CandidateClassificationIndex {
  classifications: readonly LedgerLinkingDiagnosticClassification[];
  relatedProfileCounterparts?: readonly LedgerLinkingGapCrossProfileCounterpart[] | undefined;
  timingCounterpart?: LedgerLinkingGapCounterpart | undefined;
}

export function buildLedgerLinkingGapIssues(
  diagnostics: LedgerLinkingDiagnostics,
  options: LedgerLinkingGapIssueBuildOptions = {}
): LedgerLinkingGapIssue[] {
  const index = buildCandidateClassificationIndex(diagnostics, options);

  return diagnostics.unmatchedCandidates
    .flatMap((candidate) => {
      const candidateIndex = index.get(candidate.candidateId);
      const classifications = candidateIndex?.classifications ?? ['unclassified'];
      if (isNonLinkWorkCandidate(classifications)) {
        return [];
      }

      const gapReason = resolveLedgerLinkingGapReason(
        classifications,
        candidateIndex?.timingCounterpart,
        candidateIndex?.relatedProfileCounterparts
      );

      return [
        toLedgerLinkingGapIssue(
          candidate,
          classifications,
          gapReason,
          candidateIndex?.timingCounterpart,
          candidateIndex?.relatedProfileCounterparts
        ),
      ];
    })
    .sort(compareLedgerLinkingGapIssues);
}

export function buildLedgerLinkingGapIssueKey(issue: Pick<LedgerLinkingGapIssue, 'postingFingerprint'>): string {
  return `ledger_linking_v2:${issue.postingFingerprint}`;
}

export function buildLedgerLinkingGapRef(issue: Pick<LedgerLinkingGapIssue, 'postingFingerprint'>): string {
  return sha256Hex(buildLedgerLinkingGapIssueKey(issue)).slice(0, 10);
}

function buildCandidateClassificationIndex(
  diagnostics: LedgerLinkingDiagnostics,
  options: LedgerLinkingGapIssueBuildOptions
): Map<number, CandidateClassificationIndex> {
  const timingCounterparts = buildTargetBeforeSourceCounterparts(diagnostics.amountTimeProposals);
  const index = new Map<number, CandidateClassificationIndex>();

  for (const classification of diagnostics.candidateClassifications) {
    const relatedProfileCounterparts = options.crossProfileCounterpartsByCandidateId?.get(classification.candidateId);
    index.set(classification.candidateId, {
      classifications: classification.classifications,
      ...(relatedProfileCounterparts !== undefined && relatedProfileCounterparts.length > 0
        ? { relatedProfileCounterparts }
        : {}),
      ...(timingCounterparts.has(classification.candidateId)
        ? { timingCounterpart: timingCounterparts.get(classification.candidateId) }
        : {}),
    });
  }

  return index;
}

function buildTargetBeforeSourceCounterparts(
  proposals: readonly LedgerLinkingAmountTimeProposal[]
): Map<number, LedgerLinkingGapCounterpart> {
  const counterparts = new Map<number, LedgerLinkingGapCounterpart>();

  for (const proposal of proposals) {
    if (proposal.timeDirection !== 'target_before_source') {
      continue;
    }

    counterparts.set(proposal.source.candidateId, {
      candidateId: proposal.target.candidateId,
      direction: proposal.target.direction,
      postingFingerprint: proposal.target.postingFingerprint,
      timeDirection: proposal.timeDirection,
      timeDistanceSeconds: proposal.timeDistanceSeconds,
    });
    counterparts.set(proposal.target.candidateId, {
      candidateId: proposal.source.candidateId,
      direction: proposal.source.direction,
      postingFingerprint: proposal.source.postingFingerprint,
      timeDirection: proposal.timeDirection,
      timeDistanceSeconds: proposal.timeDistanceSeconds,
    });
  }

  return counterparts;
}

function resolveLedgerLinkingGapReason(
  classifications: readonly LedgerLinkingDiagnosticClassification[],
  timingCounterpart: LedgerLinkingGapCounterpart | undefined,
  relatedProfileCounterparts: readonly LedgerLinkingGapCrossProfileCounterpart[] | undefined
): LedgerLinkingGapReason {
  if (timingCounterpart !== undefined) {
    return 'bridge_or_migration_timing_mismatch';
  }

  if (classifications.includes('processor_asset_migration_context')) {
    return 'processor_asset_migration_context';
  }

  if (relatedProfileCounterparts !== undefined && relatedProfileCounterparts.length > 0) {
    return 'related_profile_counterpart_evidence';
  }

  if (classifications.includes('exchange_transfer_missing_hash')) {
    return 'exchange_transfer_missing_hash';
  }

  if (classifications.includes('missing_linking_evidence')) {
    return 'missing_linking_evidence';
  }

  if (classifications.includes('external_transfer_evidence')) {
    return 'external_transfer_evidence_unmatched';
  }

  return 'unclassified_unmatched_transfer_candidate';
}

function isNonLinkWorkCandidate(classifications: readonly LedgerLinkingDiagnosticClassification[]): boolean {
  return (
    classifications.includes('fiat_cash_movement') ||
    classifications.includes('likely_dust_airdrop') ||
    classifications.includes('likely_spam_airdrop')
  );
}

function toLedgerLinkingGapIssue(
  candidate: LedgerLinkingCandidateRemainder,
  classifications: readonly LedgerLinkingDiagnosticClassification[],
  gapReason: LedgerLinkingGapReason,
  timingCounterpart: LedgerLinkingGapCounterpart | undefined,
  relatedProfileCounterparts: readonly LedgerLinkingGapCrossProfileCounterpart[] | undefined
): LedgerLinkingGapIssue {
  const journalDiagnosticCodes = candidate.journalDiagnosticCodes ?? [];

  return {
    activityDatetime: candidate.activityDatetime,
    assetId: candidate.assetId,
    assetSymbol: candidate.assetSymbol,
    ...(candidate.blockchainTransactionHash !== undefined
      ? { blockchainTransactionHash: candidate.blockchainTransactionHash }
      : {}),
    candidateId: candidate.candidateId,
    classifications: [...classifications],
    claimedAmount: candidate.claimedAmount,
    direction: candidate.direction,
    ...(candidate.fromAddress !== undefined ? { fromAddress: candidate.fromAddress } : {}),
    gapReason,
    journalFingerprint: candidate.journalFingerprint,
    ...(journalDiagnosticCodes.length > 0 ? { journalDiagnosticCodes: [...journalDiagnosticCodes] } : {}),
    originalAmount: candidate.originalAmount,
    ownerAccountId: candidate.ownerAccountId,
    platformKey: candidate.platformKey,
    platformKind: candidate.platformKind,
    postingFingerprint: candidate.postingFingerprint,
    remainingAmount: candidate.remainingAmount,
    ...(relatedProfileCounterparts !== undefined && relatedProfileCounterparts.length > 0
      ? { relatedProfileCounterparts: [...relatedProfileCounterparts] }
      : {}),
    sourceActivityFingerprint: candidate.sourceActivityFingerprint,
    ...(candidate.toAddress !== undefined ? { toAddress: candidate.toAddress } : {}),
    ...(timingCounterpart !== undefined ? { timingCounterpart } : {}),
  };
}

function compareLedgerLinkingGapIssues(left: LedgerLinkingGapIssue, right: LedgerLinkingGapIssue): number {
  return (
    ledgerLinkingGapReasonRank(left.gapReason) - ledgerLinkingGapReasonRank(right.gapReason) ||
    left.direction.localeCompare(right.direction) ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.platformKey.localeCompare(right.platformKey) ||
    left.activityDatetime.getTime() - right.activityDatetime.getTime() ||
    left.postingFingerprint.localeCompare(right.postingFingerprint)
  );
}

function ledgerLinkingGapReasonRank(reason: LedgerLinkingGapReason): number {
  switch (reason) {
    case 'bridge_or_migration_timing_mismatch':
      return 0;
    case 'exchange_transfer_missing_hash':
      return 1;
    case 'missing_linking_evidence':
      return 2;
    case 'processor_asset_migration_context':
      return 3;
    case 'related_profile_counterpart_evidence':
      return 4;
    case 'external_transfer_evidence_unmatched':
      return 5;
    case 'unclassified_unmatched_transfer_candidate':
      return 6;
  }
}
