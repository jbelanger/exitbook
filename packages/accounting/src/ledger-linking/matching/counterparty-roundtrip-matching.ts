import { err, normalizeIdentifierForMatching, ok, parseDecimal, sha256Hex, type Result } from '@exitbook/foundation';

import {
  type LedgerLinkingAssetIdentityResolution,
  type LedgerLinkingAssetIdentityResolver,
} from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import { validateLedgerTransferLinkingCandidates } from './candidate-validation.js';
import type { LedgerDeterministicRecognizer } from './deterministic-recognizer-runner.js';

export const LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY = 'counterparty_roundtrip';

const MAX_COUNTERPARTY_ROUNDTRIP_HOURS = 30 * 24;

export interface LedgerCounterpartyRoundtripMatch {
  amount: string;
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }>;
  counterpartyAddress: string;
  relationship: LedgerLinkingRelationshipDraft;
  selfAddress: string;
  sourceCandidateId: number;
  sourcePostingFingerprint: string;
  strategy: typeof LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY;
  targetCandidateId: number;
  targetPostingFingerprint: string;
  timingHours: string;
}

export interface LedgerCounterpartyRoundtripAmbiguity {
  candidateId: number;
  direction: LedgerTransferLinkingCandidate['direction'];
  matchingCandidateIds: readonly number[];
  reason: 'multiple_counterparty_roundtrip_counterparts';
}

export interface LedgerCounterpartyRoundtripRelationshipResult {
  ambiguities: LedgerCounterpartyRoundtripAmbiguity[];
  matches: LedgerCounterpartyRoundtripMatch[];
  relationships: LedgerLinkingRelationshipDraft[];
}

interface CounterpartyRoundtripPotentialPair {
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }>;
  counterpartyAddress: string;
  selfAddress: string;
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
  timingHours: number;
}

interface CandidateAddresses {
  counterpartyAddress: string;
  selfAddress: string;
}

export function buildLedgerCounterpartyRoundtripRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerCounterpartyRoundtripRelationshipResult, Error> {
  const validation = validateLedgerTransferLinkingCandidates(candidates);
  if (validation.isErr()) {
    return err(validation.error);
  }

  const sources = candidates.filter((candidate) => candidate.direction === 'source');
  const targets = candidates.filter((candidate) => candidate.direction === 'target');
  const potentialPairs = buildPotentialCounterpartyRoundtripPairs(sources, targets, assetIdentityResolver);
  const sourceToTargets = groupCounterpartIds(potentialPairs, 'source');
  const targetToSources = groupCounterpartIds(potentialPairs, 'target');
  const ambiguitiesResult = buildCounterpartyRoundtripAmbiguities(sourceToTargets, targetToSources, candidates);
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

export function buildLedgerCounterpartyRoundtripRecognizer(
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): LedgerDeterministicRecognizer<LedgerCounterpartyRoundtripRelationshipResult> {
  return {
    name: LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY,
    recognize(candidates) {
      const result = buildLedgerCounterpartyRoundtripRelationships(candidates, assetIdentityResolver);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok({
        consumedCandidateIds: collectCounterpartyRoundtripConsumedCandidateIds(result.value.matches),
        payload: result.value,
        relationships: result.value.relationships,
      });
    },
  };
}

function buildPotentialCounterpartyRoundtripPairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): CounterpartyRoundtripPotentialPair[] {
  const pairs: CounterpartyRoundtripPotentialPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      const pair = buildPotentialCounterpartyRoundtripPair(source, target, assetIdentityResolver);
      if (pair !== undefined) {
        pairs.push(pair);
      }
    }
  }

  return pairs;
}

function buildPotentialCounterpartyRoundtripPair(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): CounterpartyRoundtripPotentialPair | undefined {
  if (!hasCounterpartyRoundtripShape(source, target)) {
    return undefined;
  }

  const assetIdentityResolution = resolveCounterpartyRoundtripAssetIdentity(source, target, assetIdentityResolver);
  if (assetIdentityResolution === undefined) {
    return undefined;
  }

  const sourceAddresses = getSourceRoundtripAddresses(source);
  const targetAddresses = getTargetRoundtripAddresses(target);
  if (sourceAddresses === undefined || targetAddresses === undefined) {
    return undefined;
  }

  if (
    sourceAddresses.counterpartyAddress !== targetAddresses.counterpartyAddress ||
    sourceAddresses.selfAddress !== targetAddresses.selfAddress
  ) {
    return undefined;
  }

  const timingHours = getTimingHours(source, target);
  if (timingHours < 0 || timingHours > MAX_COUNTERPARTY_ROUNDTRIP_HOURS) {
    return undefined;
  }

  return {
    assetIdentityResolution,
    counterpartyAddress: sourceAddresses.counterpartyAddress,
    selfAddress: sourceAddresses.selfAddress,
    source,
    target,
    timingHours,
  };
}

function hasCounterpartyRoundtripShape(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): boolean {
  if (source.sourceActivityFingerprint === target.sourceActivityFingerprint) {
    return false;
  }

  if (source.platformKind !== 'blockchain' || target.platformKind !== 'blockchain') {
    return false;
  }

  if (source.platformKey !== target.platformKey || source.ownerAccountId !== target.ownerAccountId) {
    return false;
  }

  return source.amount.eq(target.amount);
}

function resolveCounterpartyRoundtripAssetIdentity(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }> | undefined {
  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'external_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });

  return resolution.status === 'accepted' ? resolution : undefined;
}

function getSourceRoundtripAddresses(candidate: LedgerTransferLinkingCandidate): CandidateAddresses | undefined {
  return getRoundtripAddresses({
    counterpartyAddress: candidate.toAddress,
    selfAddress: candidate.fromAddress,
  });
}

function getTargetRoundtripAddresses(candidate: LedgerTransferLinkingCandidate): CandidateAddresses | undefined {
  return getRoundtripAddresses({
    counterpartyAddress: candidate.fromAddress,
    selfAddress: candidate.toAddress,
  });
}

function getRoundtripAddresses(params: {
  counterpartyAddress: string | undefined;
  selfAddress: string | undefined;
}): CandidateAddresses | undefined {
  const counterpartyAddress = normalizeAddressForMatching(params.counterpartyAddress);
  const selfAddress = normalizeAddressForMatching(params.selfAddress);

  if (counterpartyAddress === undefined || selfAddress === undefined || counterpartyAddress === selfAddress) {
    return undefined;
  }

  return {
    counterpartyAddress,
    selfAddress,
  };
}

function normalizeAddressForMatching(address: string | undefined): string | undefined {
  const trimmedAddress = address?.trim();
  if (trimmedAddress === undefined || trimmedAddress.length === 0) {
    return undefined;
  }

  return normalizeIdentifierForMatching(trimmedAddress);
}

function getTimingHours(source: LedgerTransferLinkingCandidate, target: LedgerTransferLinkingCandidate): number {
  return (target.activityDatetime.getTime() - source.activityDatetime.getTime()) / (1000 * 60 * 60);
}

function groupCounterpartIds(
  pairs: readonly CounterpartyRoundtripPotentialPair[],
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

function buildCounterpartyRoundtripAmbiguities(
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>,
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerCounterpartyRoundtripAmbiguity[], Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const ambiguities: LedgerCounterpartyRoundtripAmbiguity[] = [];

  for (const [candidateId, matchingCandidateIds] of sourceToTargets) {
    if (matchingCandidateIds.length > 1) {
      const ambiguity = buildAmbiguity(candidatesById, candidateId, matchingCandidateIds);
      if (ambiguity.isErr()) {
        return err(ambiguity.error);
      }
      ambiguities.push(ambiguity.value);
    }
  }

  for (const [candidateId, matchingCandidateIds] of targetToSources) {
    if (matchingCandidateIds.length > 1) {
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
): Result<LedgerCounterpartyRoundtripAmbiguity, Error> {
  const candidate = candidatesById.get(candidateId);
  if (candidate === undefined) {
    return err(new Error(`Cannot build counterparty roundtrip ambiguity for unknown candidate ${candidateId}`));
  }

  return ok({
    candidateId,
    direction: candidate.direction,
    matchingCandidateIds: [...matchingCandidateIds],
    reason: 'multiple_counterparty_roundtrip_counterparts',
  });
}

function buildOneToOneMatches(
  pairs: readonly CounterpartyRoundtripPotentialPair[],
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>
): LedgerCounterpartyRoundtripMatch[] {
  const matches: LedgerCounterpartyRoundtripMatch[] = [];

  for (const pair of pairs) {
    if (
      sourceToTargets.get(pair.source.candidateId)?.length === 1 &&
      targetToSources.get(pair.target.candidateId)?.length === 1
    ) {
      matches.push(buildCounterpartyRoundtripMatch(pair));
    }
  }

  return matches.sort(compareCounterpartyRoundtripMatches);
}

function buildCounterpartyRoundtripMatch(pair: CounterpartyRoundtripPotentialPair): LedgerCounterpartyRoundtripMatch {
  return {
    amount: pair.source.amount.toFixed(),
    assetIdentityResolution: pair.assetIdentityResolution,
    counterpartyAddress: pair.counterpartyAddress,
    relationship: buildCounterpartyRoundtripRelationship(pair),
    selfAddress: pair.selfAddress,
    sourceCandidateId: pair.source.candidateId,
    sourcePostingFingerprint: pair.source.postingFingerprint,
    strategy: LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY,
    targetCandidateId: pair.target.candidateId,
    targetPostingFingerprint: pair.target.postingFingerprint,
    timingHours: formatTimingHours(pair.timingHours),
  };
}

function buildCounterpartyRoundtripRelationship(
  pair: CounterpartyRoundtripPotentialPair
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
      amount: pair.source.amount.toFixed(),
      assetIdentityReason: pair.assetIdentityResolution.reason,
      counterpartyAddress: pair.counterpartyAddress,
      platformKey: pair.source.platformKey,
      selfAddress: pair.selfAddress,
      sourceActivityDatetime: pair.source.activityDatetime.toISOString(),
      sourceBlockchainTransactionHash: pair.source.blockchainTransactionHash,
      sourcePostingFingerprint: pair.source.postingFingerprint,
      sourceRawFromAddress: pair.source.fromAddress,
      sourceRawToAddress: pair.source.toAddress,
      targetActivityDatetime: pair.target.activityDatetime.toISOString(),
      targetBlockchainTransactionHash: pair.target.blockchainTransactionHash,
      targetPostingFingerprint: pair.target.postingFingerprint,
      targetRawFromAddress: pair.target.fromAddress,
      targetRawToAddress: pair.target.toAddress,
      timingHours: formatTimingHours(pair.timingHours),
    },
    recognitionStrategy: LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY,
    relationshipStableKey: buildCounterpartyRoundtripRelationshipStableKey(pair),
    relationshipKind: 'external_transfer',
  };
}

function buildCounterpartyRoundtripRelationshipStableKey(pair: CounterpartyRoundtripPotentialPair): string {
  const payload = [
    'ledger-linking',
    LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY,
    'v1',
    pair.source.postingFingerprint,
    pair.target.postingFingerprint,
  ].join('\0');

  return `ledger-linking:${LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function collectCounterpartyRoundtripConsumedCandidateIds(
  matches: readonly LedgerCounterpartyRoundtripMatch[]
): number[] {
  const consumedCandidateIds = new Set<number>();

  for (const match of matches) {
    consumedCandidateIds.add(match.sourceCandidateId);
    consumedCandidateIds.add(match.targetCandidateId);
  }

  return [...consumedCandidateIds].sort(compareNumbers);
}

function formatTimingHours(timingHours: number): string {
  return timingHours.toFixed(6);
}

function compareCounterpartyRoundtripMatches(
  left: LedgerCounterpartyRoundtripMatch,
  right: LedgerCounterpartyRoundtripMatch
): number {
  return (
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
