import type { LedgerLinkingGapResolutionKind } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type {
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnosticClassification,
  LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';

import type { LedgerLinkingGapCrossProfileCounterpart } from './ledger-linking-gap-issues.js';

export interface LedgerLinkingGapResolutionSuggestion {
  candidate: LedgerLinkingCandidateRemainder;
  classifications: readonly LedgerLinkingDiagnosticClassification[];
  relatedProfileCounterparts?: readonly LedgerLinkingGapCrossProfileCounterpart[] | undefined;
  resolutionKind: LedgerLinkingGapResolutionKind;
  resolutionKey: string;
}

export interface LedgerLinkingGapResolutionSuggestionOptions {
  relatedProfileCounterpartsByCandidateId?:
    | ReadonlyMap<number, readonly LedgerLinkingGapCrossProfileCounterpart[]>
    | undefined;
  resolvedGapResolutionKeys?: ReadonlySet<string> | undefined;
}

export function buildLedgerLinkingGapResolutionKey(
  input: Pick<LedgerLinkingCandidateRemainder, 'postingFingerprint'>
): string {
  return `ledger_linking_v2:${input.postingFingerprint}`;
}

export function buildLedgerLinkingGapResolutionSuggestions(
  diagnostics: LedgerLinkingDiagnostics,
  options: LedgerLinkingGapResolutionSuggestionOptions = {}
): LedgerLinkingGapResolutionSuggestion[] {
  const classificationsByCandidateId = new Map(
    diagnostics.candidateClassifications.map((classification) => [
      classification.candidateId,
      classification.classifications,
    ])
  );

  return diagnostics.unmatchedCandidates
    .flatMap((candidate) => {
      const classifications = classificationsByCandidateId.get(candidate.candidateId) ?? ['unclassified'];
      const relatedProfileCounterparts = options.relatedProfileCounterpartsByCandidateId?.get(candidate.candidateId);
      const resolutionKind = resolveGapResolutionKind(candidate, classifications, relatedProfileCounterparts);
      if (resolutionKind === undefined) {
        return [];
      }

      const resolutionKey = buildLedgerLinkingGapResolutionKey(candidate);
      if (options.resolvedGapResolutionKeys?.has(resolutionKey)) {
        return [];
      }

      return [
        {
          candidate,
          classifications,
          ...(relatedProfileCounterparts !== undefined && relatedProfileCounterparts.length > 0
            ? { relatedProfileCounterparts }
            : {}),
          resolutionKind,
          resolutionKey,
        },
      ];
    })
    .sort(compareGapResolutionSuggestions);
}

function resolveGapResolutionKind(
  candidate: LedgerLinkingCandidateRemainder,
  classifications: readonly LedgerLinkingDiagnosticClassification[],
  relatedProfileCounterparts: readonly LedgerLinkingGapCrossProfileCounterpart[] | undefined
): LedgerLinkingGapResolutionKind | undefined {
  if (isAcceptedTransferResidual(candidate)) {
    return 'accepted_transfer_residual';
  }

  if (classifications.includes('fiat_cash_movement')) {
    return 'fiat_cash_movement';
  }

  if (classifications.includes('likely_spam_airdrop')) {
    return 'likely_spam_airdrop';
  }

  if (classifications.includes('likely_dust_airdrop')) {
    return 'likely_dust_airdrop';
  }

  if (relatedProfileCounterparts !== undefined && relatedProfileCounterparts.length > 0) {
    return 'related_profile_transfer';
  }

  if (classifications.includes('external_transfer_evidence')) {
    return 'external_transfer_unmatched';
  }

  return undefined;
}

function isAcceptedTransferResidual(candidate: LedgerLinkingCandidateRemainder): boolean {
  if (candidate.direction !== 'source') {
    return false;
  }

  return isPositiveDecimal(candidate.claimedAmount) && isPositiveDecimal(candidate.remainingAmount);
}

function isPositiveDecimal(value: string): boolean {
  try {
    return new Decimal(value).gt(0);
  } catch {
    return false;
  }
}

function compareGapResolutionSuggestions(
  left: LedgerLinkingGapResolutionSuggestion,
  right: LedgerLinkingGapResolutionSuggestion
): number {
  return (
    gapResolutionKindRank(left.resolutionKind) - gapResolutionKindRank(right.resolutionKind) ||
    left.candidate.direction.localeCompare(right.candidate.direction) ||
    left.candidate.assetSymbol.localeCompare(right.candidate.assetSymbol) ||
    left.candidate.platformKey.localeCompare(right.candidate.platformKey) ||
    left.candidate.activityDatetime.getTime() - right.candidate.activityDatetime.getTime() ||
    left.candidate.postingFingerprint.localeCompare(right.candidate.postingFingerprint)
  );
}

function gapResolutionKindRank(kind: LedgerLinkingGapResolutionKind): number {
  switch (kind) {
    case 'accepted_transfer_residual':
      return 0;
    case 'fiat_cash_movement':
      return 1;
    case 'likely_spam_airdrop':
      return 2;
    case 'likely_dust_airdrop':
      return 3;
    case 'related_profile_transfer':
      return 4;
    case 'external_transfer_unmatched':
      return 5;
  }
}
