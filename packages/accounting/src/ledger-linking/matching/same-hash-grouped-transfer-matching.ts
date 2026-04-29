import { err, ok, parseDecimal, sha256Hex, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { LedgerLinkingAssetIdentityResolver } from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import type { LedgerDeterministicRecognizer } from './deterministic-recognizer-runner.js';
import { normalizeLedgerTransactionHashForGrouping } from './ledger-transaction-hash-utils.js';

export const LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY = 'same_hash_grouped_transfer';

export interface LedgerSameHashGroupedTransferMatch {
  amount: string;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  normalizedBlockchainTransactionHash: string;
  relationship: LedgerLinkingRelationshipDraft;
  sourceAssetIds: readonly string[];
  sourceCandidateIds: readonly number[];
  sourcePostingFingerprints: readonly string[];
  strategy: typeof LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY;
  targetAssetIds: readonly string[];
  targetCandidateIds: readonly number[];
  targetPostingFingerprints: readonly string[];
}

export interface LedgerSameHashGroupedTransferUnresolvedGroup {
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  normalizedBlockchainTransactionHash: string;
  reason:
    | 'single_pair'
    | 'single_account'
    | 'mixed_activity_direction'
    | 'multiple_candidates_per_activity'
    | 'asset_identity_blocked'
    | 'unbalanced_amounts';
  sourceCandidateIds: readonly number[];
  targetCandidateIds: readonly number[];
  sourceAmount: string;
  targetAmount: string;
}

export interface LedgerSameHashGroupedTransferRelationshipResult {
  matches: LedgerSameHashGroupedTransferMatch[];
  relationships: LedgerLinkingRelationshipDraft[];
  unresolvedGroups: LedgerSameHashGroupedTransferUnresolvedGroup[];
}

interface SameHashCandidateGroup {
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  candidates: LedgerTransferLinkingCandidate[];
  normalizedBlockchainTransactionHash: string;
}

interface SameHashCandidateGroupParts {
  sources: LedgerTransferLinkingCandidate[];
  targets: LedgerTransferLinkingCandidate[];
}

export function buildLedgerSameHashGroupedTransferRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerSameHashGroupedTransferRelationshipResult, Error> {
  const validation = validateCandidates(candidates);
  if (validation.isErr()) {
    return err(validation.error);
  }

  const matches: LedgerSameHashGroupedTransferMatch[] = [];
  const unresolvedGroups: LedgerSameHashGroupedTransferUnresolvedGroup[] = [];

  for (const group of buildSameHashCandidateGroups(candidates)) {
    const matchResult = buildSameHashGroupedTransferMatch(group, assetIdentityResolver);
    if (matchResult.isErr()) {
      return err(matchResult.error);
    }

    if (matchResult.value.match !== undefined) {
      matches.push(matchResult.value.match);
    }
    if (matchResult.value.unresolvedGroup !== undefined) {
      unresolvedGroups.push(matchResult.value.unresolvedGroup);
    }
  }

  const sortedMatches = matches.sort(compareSameHashMatches);

  return ok({
    matches: sortedMatches,
    relationships: sortedMatches.map((match) => match.relationship),
    unresolvedGroups: unresolvedGroups.sort(compareUnresolvedGroups),
  });
}

export function buildLedgerSameHashGroupedTransferRecognizer(
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): LedgerDeterministicRecognizer<LedgerSameHashGroupedTransferRelationshipResult> {
  return {
    name: LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
    recognize(candidates) {
      const result = buildLedgerSameHashGroupedTransferRelationships(candidates, assetIdentityResolver);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok({
        consumedCandidateIds: collectSameHashConsumedCandidateIds(result.value.matches),
        payload: result.value,
        relationships: result.value.relationships,
      });
    },
  };
}

function buildSameHashCandidateGroups(candidates: readonly LedgerTransferLinkingCandidate[]): SameHashCandidateGroup[] {
  const groupsByKey = new Map<string, SameHashCandidateGroup>();

  for (const candidate of candidates) {
    const normalizedBlockchainTransactionHash = normalizeLedgerTransactionHashForGrouping(
      candidate.blockchainTransactionHash
    );
    if (normalizedBlockchainTransactionHash === undefined) {
      continue;
    }

    const groupKey = [normalizedBlockchainTransactionHash, candidate.assetSymbol].join('\u0000');
    const group =
      groupsByKey.get(groupKey) ??
      ({
        assetSymbol: candidate.assetSymbol,
        candidates: [],
        normalizedBlockchainTransactionHash,
      } satisfies SameHashCandidateGroup);
    group.candidates.push(candidate);
    groupsByKey.set(groupKey, group);
  }

  return [...groupsByKey.values()]
    .filter((group) => group.candidates.length >= 2)
    .sort((left, right) =>
      left.normalizedBlockchainTransactionHash.localeCompare(right.normalizedBlockchainTransactionHash)
    );
}

function buildSameHashGroupedTransferMatch(
  group: SameHashCandidateGroup,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<
  {
    match: LedgerSameHashGroupedTransferMatch | undefined;
    unresolvedGroup: LedgerSameHashGroupedTransferUnresolvedGroup | undefined;
  },
  Error
> {
  const parts = splitGroupCandidates(group.candidates);

  if (parts.sources.length === 0 || parts.targets.length === 0) {
    return ok({ match: undefined, unresolvedGroup: undefined });
  }

  const sourceAmount = sumCandidateAmounts(parts.sources);
  const targetAmount = sumCandidateAmounts(parts.targets);
  const unresolvedBase = buildUnresolvedGroup(group, parts, sourceAmount, targetAmount);

  if (parts.sources.length === 1 && parts.targets.length === 1) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'single_pair' } });
  }

  if (countDistinctOwnerAccounts(group.candidates) < 2) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'single_account' } });
  }

  if (hasMixedActivityDirection(group.candidates)) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'mixed_activity_direction' } });
  }

  if (hasMultipleCandidatesPerActivity(group.candidates)) {
    return ok({
      match: undefined,
      unresolvedGroup: { ...unresolvedBase, reason: 'multiple_candidates_per_activity' },
    });
  }

  if (!allSourceTargetAssetIdentitiesAccepted(parts, assetIdentityResolver)) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'asset_identity_blocked' } });
  }

  if (!sourceAmount.eq(targetAmount)) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'unbalanced_amounts' } });
  }

  const relationship = buildSameHashRelationship(group, parts);

  return ok({
    match: {
      amount: sourceAmount.toFixed(),
      assetSymbol: group.assetSymbol,
      normalizedBlockchainTransactionHash: group.normalizedBlockchainTransactionHash,
      relationship,
      sourceAssetIds: collectAssetIds(parts.sources),
      sourceCandidateIds: parts.sources.map((candidate) => candidate.candidateId).sort(compareNumbers),
      sourcePostingFingerprints: collectPostingFingerprints(parts.sources),
      strategy: LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
      targetAssetIds: collectAssetIds(parts.targets),
      targetCandidateIds: parts.targets.map((candidate) => candidate.candidateId).sort(compareNumbers),
      targetPostingFingerprints: collectPostingFingerprints(parts.targets),
    },
    unresolvedGroup: undefined,
  });
}

function buildSameHashRelationship(
  group: SameHashCandidateGroup,
  parts: SameHashCandidateGroupParts
): LedgerLinkingRelationshipDraft {
  const orderedSources = [...parts.sources].sort(compareCandidatesByPostingFingerprint);
  const orderedTargets = [...parts.targets].sort(compareCandidatesByPostingFingerprint);

  return {
    allocations: [...orderedSources, ...orderedTargets].map((candidate) => ({
      allocationSide: candidate.direction,
      sourceActivityFingerprint: candidate.sourceActivityFingerprint,
      journalFingerprint: candidate.journalFingerprint,
      postingFingerprint: candidate.postingFingerprint,
      quantity: candidate.amount,
    })),
    confidenceScore: parseDecimal('1'),
    evidence: {
      assetSymbol: group.assetSymbol,
      normalizedBlockchainTransactionHash: group.normalizedBlockchainTransactionHash,
      sourceAmount: sumCandidateAmounts(orderedSources).toFixed(),
      sourceAssetIds: collectAssetIds(orderedSources),
      sourcePostingFingerprints: collectPostingFingerprints(orderedSources),
      targetAmount: sumCandidateAmounts(orderedTargets).toFixed(),
      targetAssetIds: collectAssetIds(orderedTargets),
      targetPostingFingerprints: collectPostingFingerprints(orderedTargets),
    },
    recognitionStrategy: LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
    relationshipStableKey: buildSameHashRelationshipStableKey(group, orderedSources, orderedTargets),
    relationshipKind: 'same_hash_carryover',
  };
}

function buildSameHashRelationshipStableKey(
  group: SameHashCandidateGroup,
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[]
): string {
  const payload = [
    'ledger-linking',
    LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
    'v1',
    group.normalizedBlockchainTransactionHash,
    ...sources.map((candidate) => `source:${candidate.postingFingerprint}`),
    ...targets.map((candidate) => `target:${candidate.postingFingerprint}`),
  ].join('\0');

  return `ledger-linking:${LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function splitGroupCandidates(candidates: readonly LedgerTransferLinkingCandidate[]): SameHashCandidateGroupParts {
  const sources: LedgerTransferLinkingCandidate[] = [];
  const targets: LedgerTransferLinkingCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.direction === 'source') {
      sources.push(candidate);
    } else {
      targets.push(candidate);
    }
  }

  return { sources, targets };
}

function allSourceTargetAssetIdentitiesAccepted(
  parts: SameHashCandidateGroupParts,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): boolean {
  for (const source of parts.sources) {
    for (const target of parts.targets) {
      const resolution = assetIdentityResolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: source.assetId,
        targetAssetId: target.assetId,
      });
      if (resolution.status !== 'accepted') {
        return false;
      }
    }
  }

  return true;
}

function hasMixedActivityDirection(candidates: readonly LedgerTransferLinkingCandidate[]): boolean {
  const directionsByActivity = new Map<string, Set<LedgerTransferLinkingCandidate['direction']>>();

  for (const candidate of candidates) {
    const directions = directionsByActivity.get(candidate.sourceActivityFingerprint) ?? new Set();
    directions.add(candidate.direction);
    directionsByActivity.set(candidate.sourceActivityFingerprint, directions);
  }

  return [...directionsByActivity.values()].some((directions) => directions.size > 1);
}

function hasMultipleCandidatesPerActivity(candidates: readonly LedgerTransferLinkingCandidate[]): boolean {
  const candidateCountsByActivity = new Map<string, number>();

  for (const candidate of candidates) {
    const count = candidateCountsByActivity.get(candidate.sourceActivityFingerprint) ?? 0;
    candidateCountsByActivity.set(candidate.sourceActivityFingerprint, count + 1);
  }

  return [...candidateCountsByActivity.values()].some((count) => count > 1);
}

function buildUnresolvedGroup(
  group: SameHashCandidateGroup,
  parts: SameHashCandidateGroupParts,
  sourceAmount: Decimal,
  targetAmount: Decimal
): Omit<LedgerSameHashGroupedTransferUnresolvedGroup, 'reason'> {
  return {
    assetSymbol: group.assetSymbol,
    normalizedBlockchainTransactionHash: group.normalizedBlockchainTransactionHash,
    sourceCandidateIds: parts.sources.map((candidate) => candidate.candidateId).sort(compareNumbers),
    targetCandidateIds: parts.targets.map((candidate) => candidate.candidateId).sort(compareNumbers),
    sourceAmount: sourceAmount.toFixed(),
    targetAmount: targetAmount.toFixed(),
  };
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

function sumCandidateAmounts(candidates: readonly LedgerTransferLinkingCandidate[]): Decimal {
  return candidates.reduce((sum, candidate) => sum.plus(candidate.amount), new Decimal(0));
}

function countDistinctOwnerAccounts(candidates: readonly LedgerTransferLinkingCandidate[]): number {
  return new Set(candidates.map((candidate) => candidate.ownerAccountId)).size;
}

function collectAssetIds(candidates: readonly LedgerTransferLinkingCandidate[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.assetId))].sort();
}

function collectPostingFingerprints(candidates: readonly LedgerTransferLinkingCandidate[]): string[] {
  return candidates.map((candidate) => candidate.postingFingerprint).sort();
}

function collectSameHashConsumedCandidateIds(matches: readonly LedgerSameHashGroupedTransferMatch[]): number[] {
  const consumedCandidateIds = new Set<number>();

  for (const match of matches) {
    for (const candidateId of match.sourceCandidateIds) {
      consumedCandidateIds.add(candidateId);
    }
    for (const candidateId of match.targetCandidateIds) {
      consumedCandidateIds.add(candidateId);
    }
  }

  return [...consumedCandidateIds].sort(compareNumbers);
}

function compareSameHashMatches(
  left: LedgerSameHashGroupedTransferMatch,
  right: LedgerSameHashGroupedTransferMatch
): number {
  return (
    left.normalizedBlockchainTransactionHash.localeCompare(right.normalizedBlockchainTransactionHash) ||
    left.sourcePostingFingerprints.join('\0').localeCompare(right.sourcePostingFingerprints.join('\0')) ||
    left.targetPostingFingerprints.join('\0').localeCompare(right.targetPostingFingerprints.join('\0'))
  );
}

function compareUnresolvedGroups(
  left: LedgerSameHashGroupedTransferUnresolvedGroup,
  right: LedgerSameHashGroupedTransferUnresolvedGroup
): number {
  return (
    left.normalizedBlockchainTransactionHash.localeCompare(right.normalizedBlockchainTransactionHash) ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.reason.localeCompare(right.reason)
  );
}

function compareCandidatesByPostingFingerprint(
  left: LedgerTransferLinkingCandidate,
  right: LedgerTransferLinkingCandidate
): number {
  return left.postingFingerprint.localeCompare(right.postingFingerprint);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
