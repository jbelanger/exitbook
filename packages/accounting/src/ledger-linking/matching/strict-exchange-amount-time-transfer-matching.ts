import { err, ok, parseDecimal, sha256Hex, type Result } from '@exitbook/foundation';

import {
  type LedgerLinkingAssetIdentityResolution,
  type LedgerLinkingAssetIdentityResolver,
} from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import { validateLedgerTransferLinkingCandidates } from './candidate-validation.js';
import { buildFullCandidateClaims, type LedgerDeterministicRecognizer } from './deterministic-recognizer-runner.js';

export const LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY = 'strict_exchange_amount_time_transfer';

const MAX_STRICT_EXCHANGE_AMOUNT_TIME_SECONDS = 60 * 60;
const AMOUNT_TIME_UNIQUENESS_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MIN_PRECISION_NORMALIZED_DECIMAL_PLACES = 6;

export interface LedgerStrictExchangeAmountTimeTransferMatch {
  amount: string;
  amountMatchKind: StrictExchangeAmountMatch['kind'];
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { reason: 'accepted_assertion' }>;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  relationship: LedgerLinkingRelationshipDraft;
  sourceCandidateId: number;
  sourcePlatformKey: string;
  sourcePlatformKind: LedgerTransferLinkingCandidate['platformKind'];
  sourcePostingFingerprint: string;
  strategy: typeof LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY;
  targetCandidateId: number;
  targetPlatformKey: string;
  targetPlatformKind: LedgerTransferLinkingCandidate['platformKind'];
  targetPostingFingerprint: string;
  timeDistanceSeconds: number;
}

export interface LedgerStrictExchangeAmountTimeTransferAmbiguity {
  candidateId: number;
  direction: LedgerTransferLinkingCandidate['direction'];
  matchingCandidateIds: readonly number[];
  reason: 'multiple_strict_exchange_amount_time_counterparts';
}

export interface LedgerStrictExchangeAmountTimeTransferRelationshipResult {
  ambiguities: LedgerStrictExchangeAmountTimeTransferAmbiguity[];
  matches: LedgerStrictExchangeAmountTimeTransferMatch[];
  relationships: LedgerLinkingRelationshipDraft[];
}

interface StrictExchangeAmountTimePotentialPair {
  amountMatch: StrictExchangeAmountMatch;
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { reason: 'accepted_assertion' }>;
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
  timeDistanceSeconds: number;
}

interface AmountTimeUniquenessPair {
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
}

interface ExactStrictExchangeAmountMatch {
  amount: string;
  kind: 'exact';
}

interface PrecisionTruncatedStrictExchangeAmountMatch {
  amount: string;
  amountDifference: string;
  kind: 'precision_truncated';
  normalizedDecimalPlaces: number;
  sourceAmount: string;
  targetAmount: string;
}

type StrictExchangeAmountMatch = ExactStrictExchangeAmountMatch | PrecisionTruncatedStrictExchangeAmountMatch;

export function buildLedgerStrictExchangeAmountTimeTransferRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerStrictExchangeAmountTimeTransferRelationshipResult, Error> {
  const validation = validateLedgerTransferLinkingCandidates(candidates);
  if (validation.isErr()) {
    return err(validation.error);
  }

  const sources = candidates.filter((candidate) => candidate.direction === 'source');
  const targets = candidates.filter((candidate) => candidate.direction === 'target');
  const potentialPairsResult = buildPotentialStrictExchangeAmountTimePairs(sources, targets, assetIdentityResolver);
  if (potentialPairsResult.isErr()) {
    return err(potentialPairsResult.error);
  }

  const potentialPairs = potentialPairsResult.value;
  const uniquenessPairsResult = buildPotentialAmountTimeUniquenessPairs(sources, targets, assetIdentityResolver);
  if (uniquenessPairsResult.isErr()) {
    return err(uniquenessPairsResult.error);
  }

  const sourceToTargets = groupCounterpartIds(uniquenessPairsResult.value, 'source');
  const targetToSources = groupCounterpartIds(uniquenessPairsResult.value, 'target');
  const ambiguitiesResult = buildStrictExchangeAmountTimeAmbiguities(
    sourceToTargets,
    targetToSources,
    collectStrictPairCandidateIds(potentialPairs),
    candidates
  );
  if (ambiguitiesResult.isErr()) {
    return err(ambiguitiesResult.error);
  }

  const matches = buildOneToOneMatches(potentialPairs, sourceToTargets, targetToSources);

  return ok({
    ambiguities: ambiguitiesResult.value,
    matches,
    relationships: matches.map((match) => match.relationship),
  });
}

export function buildLedgerStrictExchangeAmountTimeTransferRecognizer(
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): LedgerDeterministicRecognizer<LedgerStrictExchangeAmountTimeTransferRelationshipResult> {
  return {
    name: LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY,
    recognize(candidates) {
      const result = buildLedgerStrictExchangeAmountTimeTransferRelationships(candidates, assetIdentityResolver);
      if (result.isErr()) {
        return err(result.error);
      }

      const candidateClaims = buildFullCandidateClaims(
        candidates,
        collectStrictExchangeAmountTimeConsumedCandidateIds(result.value.matches)
      );
      if (candidateClaims.isErr()) {
        return err(candidateClaims.error);
      }

      return ok({
        candidateClaims: candidateClaims.value,
        payload: result.value,
        relationships: result.value.relationships,
      });
    },
  };
}

function buildPotentialStrictExchangeAmountTimePairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<StrictExchangeAmountTimePotentialPair[], Error> {
  const pairs: StrictExchangeAmountTimePotentialPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      const pairResult = buildPotentialStrictExchangeAmountTimePair(source, target, assetIdentityResolver);
      if (pairResult.isErr()) {
        return err(pairResult.error);
      }

      if (pairResult.value !== undefined) {
        pairs.push(pairResult.value);
      }
    }
  }

  return ok(pairs);
}

function buildPotentialStrictExchangeAmountTimePair(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<StrictExchangeAmountTimePotentialPair | undefined, Error> {
  if (!hasStrictExchangeAmountTimeShape(source, target)) {
    return ok(undefined);
  }

  const amountMatch = getStrictExchangeAmountMatch(source, target);
  if (amountMatch === undefined) {
    return ok(undefined);
  }

  const timeDistanceSecondsResult = getSourceBeforeTargetDistanceSeconds(source, target);
  if (timeDistanceSecondsResult.isErr()) {
    return err(timeDistanceSecondsResult.error);
  }
  if (
    timeDistanceSecondsResult.value === undefined ||
    timeDistanceSecondsResult.value > MAX_STRICT_EXCHANGE_AMOUNT_TIME_SECONDS
  ) {
    return ok(undefined);
  }

  const assetIdentityResolution = resolveStrictExchangeAmountTimeAssetIdentity(source, target, assetIdentityResolver);
  if (assetIdentityResolution === undefined) {
    return ok(undefined);
  }

  return ok({
    amountMatch,
    assetIdentityResolution,
    source,
    target,
    timeDistanceSeconds: timeDistanceSecondsResult.value,
  });
}

function hasStrictExchangeAmountTimeShape(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): boolean {
  if (source.sourceActivityFingerprint === target.sourceActivityFingerprint) {
    return false;
  }

  if (source.platformKey === target.platformKey) {
    return false;
  }

  if (source.platformKind !== 'exchange' && target.platformKind !== 'exchange') {
    return false;
  }

  if (source.assetSymbol !== target.assetSymbol) {
    return false;
  }

  return true;
}

function getSourceBeforeTargetDistanceSeconds(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): Result<number | undefined, Error> {
  const sourceTime = getCandidateActivityTime(source, 'source');
  if (sourceTime.isErr()) {
    return err(sourceTime.error);
  }
  const targetTime = getCandidateActivityTime(target, 'target');
  if (targetTime.isErr()) {
    return err(targetTime.error);
  }

  const timeDistanceSeconds = (targetTime.value - sourceTime.value) / 1000;
  return ok(timeDistanceSeconds > 0 ? timeDistanceSeconds : undefined);
}

function resolveStrictExchangeAmountTimeAssetIdentity(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Extract<LedgerLinkingAssetIdentityResolution, { reason: 'accepted_assertion' }> | undefined {
  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'internal_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });

  return resolution.status === 'accepted' && resolution.reason === 'accepted_assertion' ? resolution : undefined;
}

function buildPotentialAmountTimeUniquenessPairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<AmountTimeUniquenessPair[], Error> {
  const pairs: AmountTimeUniquenessPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      const pairResult = buildPotentialAmountTimeUniquenessPair(source, target, assetIdentityResolver);
      if (pairResult.isErr()) {
        return err(pairResult.error);
      }

      if (pairResult.value !== undefined) {
        pairs.push(pairResult.value);
      }
    }
  }

  return ok(pairs);
}

function buildPotentialAmountTimeUniquenessPair(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<AmountTimeUniquenessPair | undefined, Error> {
  if (source.sourceActivityFingerprint === target.sourceActivityFingerprint) {
    return ok(undefined);
  }

  if (source.assetSymbol !== target.assetSymbol || getStrictExchangeAmountMatch(source, target) === undefined) {
    return ok(undefined);
  }

  const timeDistanceSecondsResult = getAbsoluteTimeDistanceSeconds(source, target);
  if (timeDistanceSecondsResult.isErr()) {
    return err(timeDistanceSecondsResult.error);
  }
  if (timeDistanceSecondsResult.value > AMOUNT_TIME_UNIQUENESS_WINDOW_SECONDS) {
    return ok(undefined);
  }

  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'internal_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });

  return ok(resolution.status === 'accepted' ? { source, target } : undefined);
}

function getAbsoluteTimeDistanceSeconds(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): Result<number, Error> {
  const sourceTime = getCandidateActivityTime(source, 'source');
  if (sourceTime.isErr()) {
    return err(sourceTime.error);
  }
  const targetTime = getCandidateActivityTime(target, 'target');
  if (targetTime.isErr()) {
    return err(targetTime.error);
  }

  return ok(Math.abs(targetTime.value - sourceTime.value) / 1000);
}

function getCandidateActivityTime(
  candidate: LedgerTransferLinkingCandidate,
  side: 'source' | 'target'
): Result<number, Error> {
  const activityTime = candidate.activityDatetime.getTime();
  if (!Number.isFinite(activityTime)) {
    return err(
      new Error(`Strict exchange amount/time ${side} candidate ${candidate.candidateId} has invalid activity datetime`)
    );
  }

  return ok(activityTime);
}

function groupCounterpartIds(
  pairs: readonly AmountTimeUniquenessPair[],
  direction: 'source' | 'target'
): ReadonlyMap<number, number[]> {
  const grouped = new Map<number, number[]>();

  for (const pair of pairs) {
    const candidateId = direction === 'source' ? pair.source.candidateId : pair.target.candidateId;
    const counterpartId = direction === 'source' ? pair.target.candidateId : pair.source.candidateId;
    const counterpartIds = grouped.get(candidateId) ?? [];
    counterpartIds.push(counterpartId);
    grouped.set(candidateId, counterpartIds);
  }

  for (const [candidateId, counterpartIds] of grouped) {
    grouped.set(candidateId, [...new Set(counterpartIds)].sort(compareNumbers));
  }

  return grouped;
}

function buildStrictExchangeAmountTimeAmbiguities(
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>,
  strictPairCandidateIds: ReadonlySet<number>,
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerStrictExchangeAmountTimeTransferAmbiguity[], Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const ambiguities: LedgerStrictExchangeAmountTimeTransferAmbiguity[] = [];

  for (const [candidateId, matchingCandidateIds] of sourceToTargets) {
    if (strictPairCandidateIds.has(candidateId) && matchingCandidateIds.length > 1) {
      const ambiguity = buildAmbiguity(candidatesById, candidateId, matchingCandidateIds);
      if (ambiguity.isErr()) {
        return err(ambiguity.error);
      }
      ambiguities.push(ambiguity.value);
    }
  }

  for (const [candidateId, matchingCandidateIds] of targetToSources) {
    if (strictPairCandidateIds.has(candidateId) && matchingCandidateIds.length > 1) {
      const ambiguity = buildAmbiguity(candidatesById, candidateId, matchingCandidateIds);
      if (ambiguity.isErr()) {
        return err(ambiguity.error);
      }
      ambiguities.push(ambiguity.value);
    }
  }

  return ok(ambiguities.sort((left, right) => left.candidateId - right.candidateId));
}

function buildAmbiguity(
  candidatesById: ReadonlyMap<number, LedgerTransferLinkingCandidate>,
  candidateId: number,
  matchingCandidateIds: readonly number[]
): Result<LedgerStrictExchangeAmountTimeTransferAmbiguity, Error> {
  const candidate = candidatesById.get(candidateId);
  if (candidate === undefined) {
    return err(new Error(`Cannot build strict exchange amount/time ambiguity for unknown candidate ${candidateId}`));
  }

  return ok({
    candidateId,
    direction: candidate.direction,
    matchingCandidateIds: [...matchingCandidateIds],
    reason: 'multiple_strict_exchange_amount_time_counterparts',
  });
}

function collectStrictPairCandidateIds(pairs: readonly StrictExchangeAmountTimePotentialPair[]): ReadonlySet<number> {
  const candidateIds = new Set<number>();

  for (const pair of pairs) {
    candidateIds.add(pair.source.candidateId);
    candidateIds.add(pair.target.candidateId);
  }

  return candidateIds;
}

function buildOneToOneMatches(
  pairs: readonly StrictExchangeAmountTimePotentialPair[],
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>
): LedgerStrictExchangeAmountTimeTransferMatch[] {
  const matches: LedgerStrictExchangeAmountTimeTransferMatch[] = [];

  for (const pair of pairs) {
    if (
      sourceToTargets.get(pair.source.candidateId)?.length === 1 &&
      targetToSources.get(pair.target.candidateId)?.length === 1
    ) {
      matches.push(buildStrictExchangeAmountTimeMatch(pair));
    }
  }

  return matches.sort(compareStrictExchangeAmountTimeMatches);
}

function buildStrictExchangeAmountTimeMatch(
  pair: StrictExchangeAmountTimePotentialPair
): LedgerStrictExchangeAmountTimeTransferMatch {
  return {
    amount: pair.amountMatch.amount,
    amountMatchKind: pair.amountMatch.kind,
    assetIdentityResolution: pair.assetIdentityResolution,
    assetSymbol: pair.source.assetSymbol,
    relationship: buildStrictExchangeAmountTimeRelationship(pair),
    sourceCandidateId: pair.source.candidateId,
    sourcePlatformKey: pair.source.platformKey,
    sourcePlatformKind: pair.source.platformKind,
    sourcePostingFingerprint: pair.source.postingFingerprint,
    strategy: LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY,
    targetCandidateId: pair.target.candidateId,
    targetPlatformKey: pair.target.platformKey,
    targetPlatformKind: pair.target.platformKind,
    targetPostingFingerprint: pair.target.postingFingerprint,
    timeDistanceSeconds: pair.timeDistanceSeconds,
  };
}

function buildStrictExchangeAmountTimeRelationship(
  pair: StrictExchangeAmountTimePotentialPair
): LedgerLinkingRelationshipDraft {
  return {
    allocations: [
      {
        allocationSide: 'source',
        sourceActivityFingerprint: pair.source.sourceActivityFingerprint,
        journalFingerprint: pair.source.journalFingerprint,
        postingFingerprint: pair.source.postingFingerprint,
        quantity: pair.source.amount,
      },
      {
        allocationSide: 'target',
        sourceActivityFingerprint: pair.target.sourceActivityFingerprint,
        journalFingerprint: pair.target.journalFingerprint,
        postingFingerprint: pair.target.postingFingerprint,
        quantity: pair.target.amount,
      },
    ],
    confidenceScore: parseDecimal('1'),
    evidence: {
      amount: pair.amountMatch.amount,
      assetIdentityEvidenceKind: pair.assetIdentityResolution.assertion.evidenceKind,
      assetIdentityReason: pair.assetIdentityResolution.reason,
      assetSymbol: pair.source.assetSymbol,
      sourceActivityDatetime: pair.source.activityDatetime.toISOString(),
      sourceAssetId: pair.source.assetId,
      sourcePlatformKey: pair.source.platformKey,
      sourcePlatformKind: pair.source.platformKind,
      sourcePostingFingerprint: pair.source.postingFingerprint,
      targetActivityDatetime: pair.target.activityDatetime.toISOString(),
      targetAssetId: pair.target.assetId,
      targetPlatformKey: pair.target.platformKey,
      targetPlatformKind: pair.target.platformKind,
      targetPostingFingerprint: pair.target.postingFingerprint,
      timeDistanceSeconds: pair.timeDistanceSeconds,
      ...(pair.amountMatch.kind === 'precision_truncated'
        ? {
            amountDifference: pair.amountMatch.amountDifference,
            amountMatchKind: pair.amountMatch.kind,
            normalizedAmount: pair.amountMatch.amount,
            normalizedDecimalPlaces: pair.amountMatch.normalizedDecimalPlaces,
            sourceAmount: pair.amountMatch.sourceAmount,
            targetAmount: pair.amountMatch.targetAmount,
          }
        : {}),
    },
    recognitionStrategy: LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY,
    relationshipStableKey: buildStrictExchangeAmountTimeRelationshipStableKey(pair),
    relationshipKind: 'internal_transfer',
  };
}

function getStrictExchangeAmountMatch(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): StrictExchangeAmountMatch | undefined {
  if (source.amount.eq(target.amount)) {
    return {
      amount: source.amount.toFixed(),
      kind: 'exact',
    };
  }

  return getPrecisionTruncatedAmountMatch(source.amount.toFixed(), target.amount.toFixed());
}

function getPrecisionTruncatedAmountMatch(
  sourceAmount: string,
  targetAmount: string
): PrecisionTruncatedStrictExchangeAmountMatch | undefined {
  const normalizedDecimalPlaces = Math.min(countDecimalPlaces(sourceAmount), countDecimalPlaces(targetAmount));
  if (normalizedDecimalPlaces < MIN_PRECISION_NORMALIZED_DECIMAL_PLACES) {
    return undefined;
  }

  const normalizedSourceAmount = truncateDecimalString(sourceAmount, normalizedDecimalPlaces);
  const normalizedTargetAmount = truncateDecimalString(targetAmount, normalizedDecimalPlaces);
  if (normalizedSourceAmount !== normalizedTargetAmount) {
    return undefined;
  }

  const amountDifference = parseDecimal(sourceAmount).minus(parseDecimal(targetAmount)).abs();
  const precisionUnit = parseDecimal(`0.${'0'.repeat(normalizedDecimalPlaces - 1)}1`);
  if (!amountDifference.gt(0) || !amountDifference.lt(precisionUnit)) {
    return undefined;
  }

  return {
    amount: normalizedSourceAmount,
    amountDifference: amountDifference.toFixed(),
    kind: 'precision_truncated',
    normalizedDecimalPlaces,
    sourceAmount,
    targetAmount,
  };
}

function countDecimalPlaces(amount: string): number {
  const decimalPointIndex = amount.indexOf('.');
  return decimalPointIndex === -1 ? 0 : amount.length - decimalPointIndex - 1;
}

function truncateDecimalString(amount: string, decimalPlaces: number): string {
  if (decimalPlaces === 0) {
    return amount.split('.')[0] ?? amount;
  }

  const [whole = '0', fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(decimalPlaces, '0').slice(0, decimalPlaces)}`;
}

function buildStrictExchangeAmountTimeRelationshipStableKey(pair: StrictExchangeAmountTimePotentialPair): string {
  const payload = [
    'ledger-linking',
    LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY,
    'v1',
    pair.source.postingFingerprint,
    pair.target.postingFingerprint,
  ].join('\0');

  return `ledger-linking:${LEDGER_STRICT_EXCHANGE_AMOUNT_TIME_TRANSFER_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function collectStrictExchangeAmountTimeConsumedCandidateIds(
  matches: readonly LedgerStrictExchangeAmountTimeTransferMatch[]
): number[] {
  const consumedCandidateIds = new Set<number>();

  for (const match of matches) {
    consumedCandidateIds.add(match.sourceCandidateId);
    consumedCandidateIds.add(match.targetCandidateId);
  }

  return [...consumedCandidateIds].sort(compareNumbers);
}

function compareStrictExchangeAmountTimeMatches(
  left: LedgerStrictExchangeAmountTimeTransferMatch,
  right: LedgerStrictExchangeAmountTimeTransferMatch
): number {
  return (
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
