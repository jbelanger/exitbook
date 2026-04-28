import { err, ok, sha256Hex, type Result } from '@exitbook/foundation';

import type { LedgerTransferLinkingCandidate } from './candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from './relationship-materialization.js';

export const LEDGER_EXACT_HASH_TRANSFER_STRATEGY = 'exact_hash_transfer';

export interface LedgerExactHashTransferMatch {
  strategy: typeof LEDGER_EXACT_HASH_TRANSFER_STRATEGY;
  sourceCandidateId: number;
  targetCandidateId: number;
  sourcePostingFingerprint: string;
  targetPostingFingerprint: string;
  sourceBlockchainTransactionHash: string;
  targetBlockchainTransactionHash: string;
  assetId: string;
  amount: string;
  relationship: LedgerLinkingRelationshipDraft;
}

export interface LedgerExactHashTransferAmbiguity {
  candidateId: number;
  direction: LedgerTransferLinkingCandidate['direction'];
  matchingCandidateIds: number[];
  reason: 'multiple_exact_hash_counterparts';
}

export interface LedgerExactHashTransferRelationshipResult {
  matches: LedgerExactHashTransferMatch[];
  relationships: LedgerLinkingRelationshipDraft[];
  ambiguities: LedgerExactHashTransferAmbiguity[];
}

interface ExactHashPotentialPair {
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
}

export function buildLedgerExactHashTransferRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerExactHashTransferRelationshipResult, Error> {
  const validation = validateCandidates(candidates);
  if (validation.isErr()) {
    return err(validation.error);
  }

  const sources = candidates.filter((candidate) => candidate.direction === 'source');
  const targets = candidates.filter((candidate) => candidate.direction === 'target');
  const potentialPairs = buildPotentialExactHashPairs(sources, targets);
  const sourceToTargets = groupCounterpartIds(potentialPairs, 'source');
  const targetToSources = groupCounterpartIds(potentialPairs, 'target');
  const ambiguitiesResult = buildExactHashAmbiguities(sourceToTargets, targetToSources, candidates);
  if (ambiguitiesResult.isErr()) {
    return err(ambiguitiesResult.error);
  }
  const matchesResult = buildOneToOneMatches(potentialPairs, sourceToTargets, targetToSources);
  if (matchesResult.isErr()) {
    return err(matchesResult.error);
  }
  const ambiguities = ambiguitiesResult.value;
  const matches = matchesResult.value;
  const relationships = matches.map((match) => match.relationship);

  return ok({
    matches,
    relationships,
    ambiguities,
  });
}

export function ledgerTransactionHashesMatch(
  sourceHash: string | undefined,
  targetHash: string | undefined
): boolean | undefined {
  const normalizedSource = normalizeOptionalHash(sourceHash);
  const normalizedTarget = normalizeOptionalHash(targetHash);

  if (normalizedSource === undefined || normalizedTarget === undefined) {
    return undefined;
  }

  const sourceHasLogIndex = hasLogIndexSuffix(normalizedSource);
  const targetHasLogIndex = hasLogIndexSuffix(normalizedTarget);
  const comparableSource =
    sourceHasLogIndex && targetHasLogIndex ? normalizedSource : stripLogIndexSuffix(normalizedSource);
  const comparableTarget =
    sourceHasLogIndex && targetHasLogIndex ? normalizedTarget : stripLogIndexSuffix(normalizedTarget);

  if (isHexTransactionHash(comparableSource) || isHexTransactionHash(comparableTarget)) {
    return comparableSource.toLowerCase() === comparableTarget.toLowerCase();
  }

  return comparableSource === comparableTarget;
}

function validateCandidates(candidates: readonly LedgerTransferLinkingCandidate[]): Result<void, Error> {
  const candidateIds = new Set<number>();

  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.candidateId) || candidate.candidateId <= 0) {
      return err(new Error(`Ledger linking candidate id must be a positive integer, got ${candidate.candidateId}`));
    }

    if (candidateIds.has(candidate.candidateId)) {
      return err(new Error(`Duplicate ledger linking candidate id ${candidate.candidateId}`));
    }
    candidateIds.add(candidate.candidateId);

    const candidateDirection: unknown = candidate.direction;
    if (candidateDirection !== 'source' && candidateDirection !== 'target') {
      return err(
        new Error(
          `Ledger linking candidate ${candidate.candidateId} has invalid direction ${String(candidateDirection)}`
        )
      );
    }

    if (!candidate.amount.gt(0)) {
      return err(
        new Error(
          `Ledger linking candidate ${candidate.candidateId} amount must be positive, got ${candidate.amount.toFixed()}`
        )
      );
    }

    const emptyField = findEmptyRequiredField(candidate);
    if (emptyField !== undefined) {
      return err(new Error(`Ledger linking candidate ${candidate.candidateId} has empty ${emptyField}`));
    }
  }

  return ok(undefined);
}

function findEmptyRequiredField(candidate: LedgerTransferLinkingCandidate): string | undefined {
  const fields = {
    sourceActivityFingerprint: candidate.sourceActivityFingerprint,
    journalFingerprint: candidate.journalFingerprint,
    postingFingerprint: candidate.postingFingerprint,
    platformKey: candidate.platformKey,
    assetId: candidate.assetId,
  };

  for (const [fieldName, value] of Object.entries(fields)) {
    if (value.trim().length === 0) {
      return fieldName;
    }
  }

  return undefined;
}

function buildPotentialExactHashPairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[]
): ExactHashPotentialPair[] {
  const pairs: ExactHashPotentialPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      if (isExactHashTransferPair(source, target)) {
        pairs.push({ source, target });
      }
    }
  }

  return pairs;
}

function isExactHashTransferPair(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): boolean {
  if (source.sourceActivityFingerprint === target.sourceActivityFingerprint) {
    return false;
  }

  if (source.ownerAccountId === target.ownerAccountId) {
    return false;
  }

  if (source.assetId !== target.assetId) {
    return false;
  }

  if (!source.amount.eq(target.amount)) {
    return false;
  }

  return ledgerTransactionHashesMatch(source.blockchainTransactionHash, target.blockchainTransactionHash) === true;
}

function groupCounterpartIds(
  pairs: readonly ExactHashPotentialPair[],
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

function buildExactHashAmbiguities(
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>,
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerExactHashTransferAmbiguity[], Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const ambiguities: LedgerExactHashTransferAmbiguity[] = [];

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
): Result<LedgerExactHashTransferAmbiguity, Error> {
  const candidate = candidatesById.get(candidateId);
  if (candidate === undefined) {
    return err(new Error(`Cannot build exact-hash ambiguity for unknown candidate ${candidateId}`));
  }

  return ok({
    candidateId,
    direction: candidate.direction,
    matchingCandidateIds: [...matchingCandidateIds],
    reason: 'multiple_exact_hash_counterparts',
  });
}

function buildOneToOneMatches(
  pairs: readonly ExactHashPotentialPair[],
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>
): Result<LedgerExactHashTransferMatch[], Error> {
  const matches: LedgerExactHashTransferMatch[] = [];

  for (const pair of pairs) {
    if (
      sourceToTargets.get(pair.source.candidateId)?.length === 1 &&
      targetToSources.get(pair.target.candidateId)?.length === 1
    ) {
      const match = buildExactHashTransferMatch(pair);
      if (match.isErr()) {
        return err(match.error);
      }
      matches.push(match.value);
    }
  }

  return ok(matches.sort(compareExactHashMatches));
}

function buildExactHashTransferMatch(pair: ExactHashPotentialPair): Result<LedgerExactHashTransferMatch, Error> {
  const sourceHash = pair.source.blockchainTransactionHash;
  const targetHash = pair.target.blockchainTransactionHash;
  if (sourceHash === undefined || targetHash === undefined) {
    return err(new Error('Cannot build exact-hash transfer match without hashes on both endpoints'));
  }

  return ok({
    strategy: LEDGER_EXACT_HASH_TRANSFER_STRATEGY,
    sourceCandidateId: pair.source.candidateId,
    targetCandidateId: pair.target.candidateId,
    sourcePostingFingerprint: pair.source.postingFingerprint,
    targetPostingFingerprint: pair.target.postingFingerprint,
    sourceBlockchainTransactionHash: sourceHash,
    targetBlockchainTransactionHash: targetHash,
    assetId: pair.source.assetId,
    amount: pair.source.amount.toFixed(),
    relationship: {
      relationshipStableKey: buildExactHashRelationshipStableKey(pair),
      relationshipKind: 'internal_transfer',
      source: {
        sourceActivityFingerprint: pair.source.sourceActivityFingerprint,
        journalFingerprint: pair.source.journalFingerprint,
        postingFingerprint: pair.source.postingFingerprint,
      },
      target: {
        sourceActivityFingerprint: pair.target.sourceActivityFingerprint,
        journalFingerprint: pair.target.journalFingerprint,
        postingFingerprint: pair.target.postingFingerprint,
      },
    },
  });
}

function buildExactHashRelationshipStableKey(pair: ExactHashPotentialPair): string {
  const payload = [
    'ledger-linking',
    LEDGER_EXACT_HASH_TRANSFER_STRATEGY,
    'v1',
    pair.source.postingFingerprint,
    pair.target.postingFingerprint,
  ].join('\0');

  return `ledger-linking:${LEDGER_EXACT_HASH_TRANSFER_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function normalizeOptionalHash(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function hasLogIndexSuffix(value: string): boolean {
  return /-\d+$/.test(value);
}

function stripLogIndexSuffix(value: string): string {
  return value.replace(/-\d+$/, '');
}

function isHexTransactionHash(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function compareExactHashMatches(left: LedgerExactHashTransferMatch, right: LedgerExactHashTransferMatch): number {
  return (
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
