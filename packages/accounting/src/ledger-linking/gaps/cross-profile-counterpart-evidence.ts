import { parseDecimal } from '@exitbook/foundation';

import type {
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnosticClassification,
  LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';

import type { LedgerLinkingGapCrossProfileCounterpart } from './ledger-linking-gap-issues.js';

const DEFAULT_CROSS_PROFILE_COUNTERPART_WINDOW_SECONDS = 60 * 60;
const DEFAULT_MAX_CROSS_PROFILE_COUNTERPARTS = 3;

export interface LedgerLinkingCrossProfileDiagnostics {
  diagnostics: LedgerLinkingDiagnostics;
  profileDisplayName: string;
  profileId: number;
  profileKey: string;
}

interface IndexedCounterpartCandidate {
  candidate: LedgerLinkingCandidateRemainder;
  profileDisplayName: string;
  profileKey: string;
  timestampMs: number;
}

export function buildLedgerLinkingCrossProfileCounterpartsByCandidateId(
  activeDiagnostics: LedgerLinkingDiagnostics,
  crossProfileDiagnostics: readonly LedgerLinkingCrossProfileDiagnostics[],
  options: {
    maxCounterparts?: number | undefined;
    windowSeconds?: number | undefined;
  } = {}
): Map<number, LedgerLinkingGapCrossProfileCounterpart[]> {
  if (activeDiagnostics.unmatchedCandidates.length === 0 || crossProfileDiagnostics.length === 0) {
    return new Map();
  }

  const counterpartLookup = buildCounterpartLookup(crossProfileDiagnostics);
  const counterpartsByCandidateId = new Map<number, LedgerLinkingGapCrossProfileCounterpart[]>();
  const windowSeconds = options.windowSeconds ?? DEFAULT_CROSS_PROFILE_COUNTERPART_WINDOW_SECONDS;
  const maxCounterparts = options.maxCounterparts ?? DEFAULT_MAX_CROSS_PROFILE_COUNTERPARTS;

  const activeClassificationsByCandidateId = buildClassificationsByCandidateId(activeDiagnostics);

  for (const candidate of activeDiagnostics.unmatchedCandidates) {
    if (!isCrossProfileEvidenceCandidate(activeClassificationsByCandidateId.get(candidate.candidateId) ?? [])) {
      continue;
    }

    const timestampMs = candidate.activityDatetime.getTime();
    const lookupKey = buildCounterpartLookupKey(
      candidate.direction === 'source' ? 'target' : 'source',
      candidate.assetSymbol,
      candidate.remainingAmount
    );
    const candidates = counterpartLookup.get(lookupKey);
    if (candidates === undefined || candidates.length === 0) {
      continue;
    }

    const matchingCounterparts = candidates
      .map((counterpart) => ({
        counterpart,
        secondsDeltaFromGap: (counterpart.timestampMs - timestampMs) / 1000,
      }))
      .filter((entry) => Math.abs(entry.secondsDeltaFromGap) <= windowSeconds)
      .sort(compareCounterpartMatches)
      .slice(0, maxCounterparts)
      .map(({ counterpart, secondsDeltaFromGap }) => toGapCrossProfileCounterpart(counterpart, secondsDeltaFromGap));

    if (matchingCounterparts.length > 0) {
      counterpartsByCandidateId.set(candidate.candidateId, matchingCounterparts);
    }
  }

  return counterpartsByCandidateId;
}

function buildCounterpartLookup(
  crossProfileDiagnostics: readonly LedgerLinkingCrossProfileDiagnostics[]
): Map<string, IndexedCounterpartCandidate[]> {
  const lookup = new Map<string, IndexedCounterpartCandidate[]>();

  for (const profile of crossProfileDiagnostics) {
    const classificationsByCandidateId = buildClassificationsByCandidateId(profile.diagnostics);
    for (const candidate of profile.diagnostics.unmatchedCandidates) {
      if (!isCrossProfileEvidenceCandidate(classificationsByCandidateId.get(candidate.candidateId) ?? [])) {
        continue;
      }

      const timestampMs = candidate.activityDatetime.getTime();
      if (!Number.isFinite(timestampMs)) {
        continue;
      }

      const lookupKey = buildCounterpartLookupKey(
        candidate.direction,
        candidate.assetSymbol,
        candidate.remainingAmount
      );
      const candidates = lookup.get(lookupKey) ?? [];
      candidates.push({
        candidate,
        profileDisplayName: profile.profileDisplayName,
        profileKey: profile.profileKey,
        timestampMs,
      });
      lookup.set(lookupKey, candidates);
    }
  }

  return lookup;
}

function buildClassificationsByCandidateId(
  diagnostics: LedgerLinkingDiagnostics
): Map<number, readonly LedgerLinkingDiagnosticClassification[]> {
  return new Map(
    diagnostics.candidateClassifications.map((classification) => [
      classification.candidateId,
      classification.classifications,
    ])
  );
}

function isCrossProfileEvidenceCandidate(classifications: readonly LedgerLinkingDiagnosticClassification[]): boolean {
  return !(
    classifications.includes('fiat_cash_movement') ||
    classifications.includes('likely_dust_airdrop') ||
    classifications.includes('likely_spam_airdrop')
  );
}

function buildCounterpartLookupKey(direction: 'source' | 'target', assetSymbol: string, amount: string): string {
  return `${direction}|${assetSymbol.trim().toUpperCase()}|${parseDecimal(amount).toFixed()}`;
}

function toGapCrossProfileCounterpart(
  indexed: IndexedCounterpartCandidate,
  secondsDeltaFromGap: number
): LedgerLinkingGapCrossProfileCounterpart {
  const { candidate } = indexed;

  return {
    activityDatetime: candidate.activityDatetime,
    amount: candidate.remainingAmount,
    candidateId: candidate.candidateId,
    direction: candidate.direction,
    platformKey: candidate.platformKey,
    platformKind: candidate.platformKind,
    postingFingerprint: candidate.postingFingerprint,
    profileDisplayName: indexed.profileDisplayName,
    profileKey: indexed.profileKey,
    secondsDeltaFromGap,
  };
}

function compareCounterpartMatches(
  left: { counterpart: IndexedCounterpartCandidate; secondsDeltaFromGap: number },
  right: { counterpart: IndexedCounterpartCandidate; secondsDeltaFromGap: number }
): number {
  const deltaCompare = Math.abs(left.secondsDeltaFromGap) - Math.abs(right.secondsDeltaFromGap);
  if (deltaCompare !== 0) {
    return deltaCompare;
  }

  const timeCompare = left.counterpart.timestampMs - right.counterpart.timestampMs;
  if (timeCompare !== 0) {
    return timeCompare;
  }

  const profileCompare = left.counterpart.profileKey.localeCompare(right.counterpart.profileKey);
  if (profileCompare !== 0) {
    return profileCompare;
  }

  return left.counterpart.candidate.postingFingerprint.localeCompare(right.counterpart.candidate.postingFingerprint);
}
