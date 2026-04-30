import type { LedgerLinkingGapResolutionKind } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type {
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnosticClassification,
  LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';

export interface LedgerLinkingGapResolutionSuggestion {
  candidate: LedgerLinkingCandidateRemainder;
  classifications: readonly LedgerLinkingDiagnosticClassification[];
  resolutionKind: LedgerLinkingGapResolutionKind;
  resolutionKey: string;
}

export interface LedgerLinkingGapResolutionSuggestionOptions {
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
      const resolutionKind = resolveGapResolutionKind(candidate, classifications);
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
          resolutionKind,
          resolutionKey,
        },
      ];
    })
    .sort(compareGapResolutionSuggestions);
}

function resolveGapResolutionKind(
  candidate: LedgerLinkingCandidateRemainder,
  classifications: readonly LedgerLinkingDiagnosticClassification[]
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
  }
}
