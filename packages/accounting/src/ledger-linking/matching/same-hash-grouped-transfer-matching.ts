import { err, ok, parseDecimal, sha256Hex, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { LedgerLinkingAssetIdentityResolver } from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import { validateLedgerTransferLinkingCandidates } from './candidate-validation.js';
import type {
  LedgerDeterministicCandidateClaim,
  LedgerDeterministicRecognizer,
} from './deterministic-recognizer-runner.js';
import { normalizeLedgerTransactionHashForGrouping } from './ledger-transaction-hash-utils.js';

export const LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY = 'same_hash_grouped_transfer';

export interface LedgerSameHashGroupedTransferMatch {
  amount: string;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  normalizedBlockchainTransactionHash: string;
  relationship: LedgerLinkingRelationshipDraft;
  residualAmount: string | undefined;
  residualSide: LedgerTransferLinkingCandidate['direction'] | undefined;
  sourceAssetIds: readonly string[];
  sourceCandidateIds: readonly number[];
  sourceClaims: readonly LedgerSameHashGroupedTransferCandidateClaim[];
  sourcePostingFingerprints: readonly string[];
  strategy: typeof LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY;
  targetAssetIds: readonly string[];
  targetCandidateIds: readonly number[];
  targetClaims: readonly LedgerSameHashGroupedTransferCandidateClaim[];
  targetPostingFingerprints: readonly string[];
}

export interface LedgerSameHashGroupedTransferCandidateClaim {
  candidateId: number;
  postingFingerprint: string;
  quantity: Decimal;
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
    | 'partial_amount_ambiguous'
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

interface SameHashAllocationParts {
  matchedAmount: Decimal;
  residualAmount: Decimal | undefined;
  residualSide: LedgerTransferLinkingCandidate['direction'] | undefined;
  sources: SameHashCandidateAllocation[];
  targets: SameHashCandidateAllocation[];
}

interface SameHashCandidateAllocation {
  candidate: LedgerTransferLinkingCandidate;
  quantity: Decimal;
}

export function buildLedgerSameHashGroupedTransferRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerSameHashGroupedTransferRelationshipResult, Error> {
  const validation = validateLedgerTransferLinkingCandidates(candidates);
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
        candidateClaims: collectSameHashCandidateClaims(result.value.matches),
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

  if (sourceAmount.eq(targetAmount) && parts.sources.length === 1 && parts.targets.length === 1) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'single_pair' } });
  }

  const allocationParts = buildSameHashAllocationParts(parts, sourceAmount, targetAmount);
  if (allocationParts === undefined) {
    return ok({ match: undefined, unresolvedGroup: { ...unresolvedBase, reason: 'partial_amount_ambiguous' } });
  }

  const relationship = buildSameHashRelationship(group, allocationParts);

  return ok({
    match: {
      amount: allocationParts.matchedAmount.toFixed(),
      assetSymbol: group.assetSymbol,
      normalizedBlockchainTransactionHash: group.normalizedBlockchainTransactionHash,
      relationship,
      residualAmount: allocationParts.residualAmount?.toFixed(),
      residualSide: allocationParts.residualSide,
      sourceAssetIds: collectAllocatedAssetIds(allocationParts.sources),
      sourceCandidateIds: collectAllocatedCandidateIds(allocationParts.sources),
      sourceClaims: toSameHashCandidateClaims(allocationParts.sources),
      sourcePostingFingerprints: collectAllocatedPostingFingerprints(allocationParts.sources),
      strategy: LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
      targetAssetIds: collectAllocatedAssetIds(allocationParts.targets),
      targetCandidateIds: collectAllocatedCandidateIds(allocationParts.targets),
      targetClaims: toSameHashCandidateClaims(allocationParts.targets),
      targetPostingFingerprints: collectAllocatedPostingFingerprints(allocationParts.targets),
    },
    unresolvedGroup: undefined,
  });
}

function buildSameHashRelationship(
  group: SameHashCandidateGroup,
  parts: SameHashAllocationParts
): LedgerLinkingRelationshipDraft {
  const orderedSources = [...parts.sources].sort(compareAllocationsByPostingFingerprint);
  const orderedTargets = [...parts.targets].sort(compareAllocationsByPostingFingerprint);

  return {
    allocations: [...orderedSources, ...orderedTargets].map((candidate) => ({
      allocationSide: candidate.candidate.direction,
      sourceActivityFingerprint: candidate.candidate.sourceActivityFingerprint,
      journalFingerprint: candidate.candidate.journalFingerprint,
      postingFingerprint: candidate.candidate.postingFingerprint,
      quantity: candidate.quantity,
    })),
    confidenceScore: parseDecimal('1'),
    evidence: {
      assetSymbol: group.assetSymbol,
      matchedAmount: parts.matchedAmount.toFixed(),
      normalizedBlockchainTransactionHash: group.normalizedBlockchainTransactionHash,
      residualAmount: parts.residualAmount?.toFixed(),
      residualSide: parts.residualSide,
      sourceAmount: sumAllocatedAmounts(orderedSources).toFixed(),
      sourceAssetIds: collectAllocatedAssetIds(orderedSources),
      sourcePostingFingerprints: collectAllocatedPostingFingerprints(orderedSources),
      targetAmount: sumAllocatedAmounts(orderedTargets).toFixed(),
      targetAssetIds: collectAllocatedAssetIds(orderedTargets),
      targetPostingFingerprints: collectAllocatedPostingFingerprints(orderedTargets),
    },
    recognitionStrategy: LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
    relationshipStableKey: buildSameHashRelationshipStableKey(group, orderedSources, orderedTargets),
    relationshipKind: 'same_hash_carryover',
  };
}

function buildSameHashRelationshipStableKey(
  group: SameHashCandidateGroup,
  sources: readonly SameHashCandidateAllocation[],
  targets: readonly SameHashCandidateAllocation[]
): string {
  const payload = [
    'ledger-linking',
    LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
    'v1',
    group.normalizedBlockchainTransactionHash,
    ...sources.map(
      (allocation) => `source:${allocation.candidate.postingFingerprint}:${allocation.quantity.toFixed()}`
    ),
    ...targets.map(
      (allocation) => `target:${allocation.candidate.postingFingerprint}:${allocation.quantity.toFixed()}`
    ),
  ].join('\0');

  return `ledger-linking:${LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function buildSameHashAllocationParts(
  parts: SameHashCandidateGroupParts,
  sourceAmount: Decimal,
  targetAmount: Decimal
): SameHashAllocationParts | undefined {
  if (sourceAmount.eq(targetAmount)) {
    return {
      matchedAmount: sourceAmount,
      residualAmount: undefined,
      residualSide: undefined,
      sources: parts.sources.map(toFullAllocation),
      targets: parts.targets.map(toFullAllocation),
    };
  }

  if (sourceAmount.gt(targetAmount)) {
    if (parts.sources.length !== 1) {
      return undefined;
    }

    return {
      matchedAmount: targetAmount,
      residualAmount: sourceAmount.minus(targetAmount),
      residualSide: 'source',
      sources: [{ candidate: parts.sources[0]!, quantity: targetAmount }],
      targets: parts.targets.map(toFullAllocation),
    };
  }

  if (parts.targets.length !== 1) {
    return undefined;
  }

  return {
    matchedAmount: sourceAmount,
    residualAmount: targetAmount.minus(sourceAmount),
    residualSide: 'target',
    sources: parts.sources.map(toFullAllocation),
    targets: [{ candidate: parts.targets[0]!, quantity: sourceAmount }],
  };
}

function toFullAllocation(candidate: LedgerTransferLinkingCandidate): SameHashCandidateAllocation {
  return {
    candidate,
    quantity: candidate.amount,
  };
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

function sumCandidateAmounts(candidates: readonly LedgerTransferLinkingCandidate[]): Decimal {
  return candidates.reduce((sum, candidate) => sum.plus(candidate.amount), new Decimal(0));
}

function countDistinctOwnerAccounts(candidates: readonly LedgerTransferLinkingCandidate[]): number {
  return new Set(candidates.map((candidate) => candidate.ownerAccountId)).size;
}

function collectAllocatedAssetIds(allocations: readonly SameHashCandidateAllocation[]): string[] {
  return [...new Set(allocations.map((allocation) => allocation.candidate.assetId))].sort();
}

function collectAllocatedCandidateIds(allocations: readonly SameHashCandidateAllocation[]): number[] {
  return allocations.map((allocation) => allocation.candidate.candidateId).sort(compareNumbers);
}

function collectAllocatedPostingFingerprints(allocations: readonly SameHashCandidateAllocation[]): string[] {
  return allocations.map((allocation) => allocation.candidate.postingFingerprint).sort();
}

function toSameHashCandidateClaims(
  allocations: readonly SameHashCandidateAllocation[]
): LedgerSameHashGroupedTransferCandidateClaim[] {
  return allocations.map((allocation) => ({
    candidateId: allocation.candidate.candidateId,
    postingFingerprint: allocation.candidate.postingFingerprint,
    quantity: allocation.quantity,
  }));
}

function sumAllocatedAmounts(allocations: readonly SameHashCandidateAllocation[]): Decimal {
  return allocations.reduce((sum, allocation) => sum.plus(allocation.quantity), new Decimal(0));
}

function collectSameHashCandidateClaims(
  matches: readonly LedgerSameHashGroupedTransferMatch[]
): LedgerDeterministicCandidateClaim[] {
  const candidateClaims: LedgerDeterministicCandidateClaim[] = [];

  for (const match of matches) {
    candidateClaims.push(...match.sourceClaims, ...match.targetClaims);
  }

  return candidateClaims.sort((left, right) => left.candidateId - right.candidateId);
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

function compareAllocationsByPostingFingerprint(
  left: SameHashCandidateAllocation,
  right: SameHashCandidateAllocation
): number {
  return left.candidate.postingFingerprint.localeCompare(right.candidate.postingFingerprint);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
