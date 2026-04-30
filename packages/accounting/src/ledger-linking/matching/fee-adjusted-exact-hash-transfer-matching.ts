import { err, ok, parseDecimal, sha256Hex, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import {
  type LedgerLinkingAssetIdentityResolution,
  type LedgerLinkingAssetIdentityResolver,
} from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import { validateLedgerTransferLinkingCandidates } from './candidate-validation.js';
import type {
  LedgerDeterministicCandidateClaim,
  LedgerDeterministicRecognizer,
} from './deterministic-recognizer-runner.js';
import { ledgerTransactionHashesMatch } from './ledger-transaction-hash-utils.js';

export const LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY = 'fee_adjusted_exact_hash_transfer';

const MAX_FEE_ADJUSTED_EXACT_HASH_SECONDS = 24 * 60 * 60;

export interface LedgerFeeAdjustedExactHashTransferMatch {
  amount: string;
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }>;
  residualAmount: string;
  residualSide: 'source';
  relationship: LedgerLinkingRelationshipDraft;
  sourceAmount: string;
  sourceAssetId: string;
  sourceBlockchainTransactionHash: string;
  sourceCandidateId: number;
  sourcePostingFingerprint: string;
  strategy: typeof LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY;
  targetAmount: string;
  targetAssetId: string;
  targetBlockchainTransactionHash: string;
  targetCandidateId: number;
  targetPostingFingerprint: string;
  timeDistanceSeconds: number;
}

export interface LedgerFeeAdjustedExactHashTransferAmbiguity {
  candidateId: number;
  direction: LedgerTransferLinkingCandidate['direction'];
  matchingCandidateIds: readonly number[];
  reason: 'multiple_fee_adjusted_exact_hash_counterparts';
}

export interface LedgerFeeAdjustedExactHashAssetIdentityBlock {
  amount: string;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  reason: 'same_symbol_different_asset_ids';
  residualAmount: string;
  residualSide: 'source';
  sourceAmount: string;
  sourceAssetId: string;
  sourceBlockchainTransactionHash: string;
  sourceCandidateId: number;
  sourcePostingFingerprint: string;
  targetAmount: string;
  targetAssetId: string;
  targetBlockchainTransactionHash: string;
  targetCandidateId: number;
  targetPostingFingerprint: string;
  timeDistanceSeconds: number;
}

export interface LedgerFeeAdjustedExactHashTransferRelationshipResult {
  assetIdentityBlocks: LedgerFeeAdjustedExactHashAssetIdentityBlock[];
  ambiguities: LedgerFeeAdjustedExactHashTransferAmbiguity[];
  matches: LedgerFeeAdjustedExactHashTransferMatch[];
  relationships: LedgerLinkingRelationshipDraft[];
}

interface FeeAdjustedExactHashPotentialPair {
  assetIdentityResolution: Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }>;
  residualAmount: Decimal;
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
  timeDistanceSeconds: number;
}

interface FeeAdjustedExactHashAssetIdentityBlockPair {
  residualAmount: Decimal;
  source: LedgerTransferLinkingCandidate;
  target: LedgerTransferLinkingCandidate;
  timeDistanceSeconds: number;
}

export function buildLedgerFeeAdjustedExactHashTransferRelationships(
  candidates: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerFeeAdjustedExactHashTransferRelationshipResult, Error> {
  const validation = validateLedgerTransferLinkingCandidates(candidates);
  if (validation.isErr()) {
    return err(validation.error);
  }

  const sources = candidates.filter((candidate) => candidate.direction === 'source');
  const targets = candidates.filter((candidate) => candidate.direction === 'target');
  const potentialPairs = buildPotentialFeeAdjustedExactHashPairs(sources, targets, assetIdentityResolver);
  const sourceToTargets = groupCounterpartIds(potentialPairs, 'source');
  const targetToSources = groupCounterpartIds(potentialPairs, 'target');
  const ambiguitiesResult = buildFeeAdjustedExactHashAmbiguities(sourceToTargets, targetToSources, candidates);
  if (ambiguitiesResult.isErr()) {
    return err(ambiguitiesResult.error);
  }

  const matchesResult = buildOneToOneMatches(potentialPairs, sourceToTargets, targetToSources);
  if (matchesResult.isErr()) {
    return err(matchesResult.error);
  }

  const assetIdentityBlocksResult = buildFeeAdjustedExactHashAssetIdentityBlocks(
    sources,
    targets,
    assetIdentityResolver
  );
  if (assetIdentityBlocksResult.isErr()) {
    return err(assetIdentityBlocksResult.error);
  }

  return ok({
    assetIdentityBlocks: assetIdentityBlocksResult.value,
    ambiguities: ambiguitiesResult.value,
    matches: matchesResult.value,
    relationships: matchesResult.value.map((match) => match.relationship),
  });
}

export function buildLedgerFeeAdjustedExactHashTransferRecognizer(
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): LedgerDeterministicRecognizer<LedgerFeeAdjustedExactHashTransferRelationshipResult> {
  return {
    name: LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY,
    recognize(candidates) {
      const result = buildLedgerFeeAdjustedExactHashTransferRelationships(candidates, assetIdentityResolver);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok({
        candidateClaims: collectFeeAdjustedExactHashCandidateClaims(result.value.matches),
        payload: result.value,
        relationships: result.value.relationships,
      });
    },
  };
}

function buildPotentialFeeAdjustedExactHashPairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): FeeAdjustedExactHashPotentialPair[] {
  const pairs: FeeAdjustedExactHashPotentialPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      const pair = buildPotentialFeeAdjustedExactHashPair(source, target, assetIdentityResolver);
      if (pair !== undefined) {
        pairs.push(pair);
      }
    }
  }

  return pairs;
}

function buildPotentialFeeAdjustedExactHashPair(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): FeeAdjustedExactHashPotentialPair | undefined {
  const shape = getFeeAdjustedExactHashShape(source, target);
  if (shape === undefined) {
    return undefined;
  }

  const assetIdentityResolution = resolveFeeAdjustedExactHashAssetIdentity(source, target, assetIdentityResolver);
  if (assetIdentityResolution === undefined) {
    return undefined;
  }

  return {
    assetIdentityResolution,
    residualAmount: shape.residualAmount,
    source,
    target,
    timeDistanceSeconds: shape.timeDistanceSeconds,
  };
}

function resolveFeeAdjustedExactHashAssetIdentity(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Extract<LedgerLinkingAssetIdentityResolution, { status: 'accepted' }> | undefined {
  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'internal_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });

  return resolution.status === 'accepted' ? resolution : undefined;
}

function getFeeAdjustedExactHashShape(
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): { residualAmount: Decimal; timeDistanceSeconds: number } | undefined {
  if (source.sourceActivityFingerprint === target.sourceActivityFingerprint) {
    return undefined;
  }

  if (source.ownerAccountId === target.ownerAccountId) {
    return undefined;
  }

  if (source.platformKind !== 'exchange' || source.platformKey === target.platformKey) {
    return undefined;
  }

  if (source.assetSymbol !== target.assetSymbol || !source.amount.gt(target.amount)) {
    return undefined;
  }

  const timeDistanceSeconds = (target.activityDatetime.getTime() - source.activityDatetime.getTime()) / 1000;
  if (!Number.isFinite(timeDistanceSeconds) || timeDistanceSeconds < 0) {
    return undefined;
  }

  if (timeDistanceSeconds > MAX_FEE_ADJUSTED_EXACT_HASH_SECONDS) {
    return undefined;
  }

  if (ledgerTransactionHashesMatch(source.blockchainTransactionHash, target.blockchainTransactionHash) !== true) {
    return undefined;
  }

  return {
    residualAmount: source.amount.minus(target.amount),
    timeDistanceSeconds,
  };
}

function groupCounterpartIds(
  pairs: readonly (FeeAdjustedExactHashPotentialPair | FeeAdjustedExactHashAssetIdentityBlockPair)[],
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

function buildFeeAdjustedExactHashAmbiguities(
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>,
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerFeeAdjustedExactHashTransferAmbiguity[], Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const ambiguities: LedgerFeeAdjustedExactHashTransferAmbiguity[] = [];

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
): Result<LedgerFeeAdjustedExactHashTransferAmbiguity, Error> {
  const candidate = candidatesById.get(candidateId);
  if (candidate === undefined) {
    return err(new Error(`Cannot build fee-adjusted exact-hash ambiguity for unknown candidate ${candidateId}`));
  }

  return ok({
    candidateId,
    direction: candidate.direction,
    matchingCandidateIds: [...matchingCandidateIds],
    reason: 'multiple_fee_adjusted_exact_hash_counterparts',
  });
}

function buildOneToOneMatches(
  pairs: readonly FeeAdjustedExactHashPotentialPair[],
  sourceToTargets: ReadonlyMap<number, number[]>,
  targetToSources: ReadonlyMap<number, number[]>
): Result<LedgerFeeAdjustedExactHashTransferMatch[], Error> {
  const matches: LedgerFeeAdjustedExactHashTransferMatch[] = [];

  for (const pair of pairs) {
    if (
      sourceToTargets.get(pair.source.candidateId)?.length === 1 &&
      targetToSources.get(pair.target.candidateId)?.length === 1
    ) {
      const match = buildFeeAdjustedExactHashTransferMatch(pair);
      if (match.isErr()) {
        return err(match.error);
      }
      matches.push(match.value);
    }
  }

  return ok(matches.sort(compareFeeAdjustedExactHashMatches));
}

function buildFeeAdjustedExactHashTransferMatch(
  pair: FeeAdjustedExactHashPotentialPair
): Result<LedgerFeeAdjustedExactHashTransferMatch, Error> {
  const sourceHash = pair.source.blockchainTransactionHash;
  const targetHash = pair.target.blockchainTransactionHash;
  if (sourceHash === undefined || targetHash === undefined) {
    return err(new Error('Cannot build fee-adjusted exact-hash transfer match without hashes on both endpoints'));
  }

  return ok({
    amount: pair.target.amount.toFixed(),
    assetIdentityResolution: pair.assetIdentityResolution,
    residualAmount: pair.residualAmount.toFixed(),
    residualSide: 'source',
    relationship: buildFeeAdjustedExactHashRelationship(pair, sourceHash, targetHash),
    sourceAmount: pair.source.amount.toFixed(),
    sourceAssetId: pair.source.assetId,
    sourceBlockchainTransactionHash: sourceHash,
    sourceCandidateId: pair.source.candidateId,
    sourcePostingFingerprint: pair.source.postingFingerprint,
    strategy: LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY,
    targetAmount: pair.target.amount.toFixed(),
    targetAssetId: pair.target.assetId,
    targetBlockchainTransactionHash: targetHash,
    targetCandidateId: pair.target.candidateId,
    targetPostingFingerprint: pair.target.postingFingerprint,
    timeDistanceSeconds: pair.timeDistanceSeconds,
  });
}

function buildFeeAdjustedExactHashRelationship(
  pair: FeeAdjustedExactHashPotentialPair,
  sourceHash: string,
  targetHash: string
): LedgerLinkingRelationshipDraft {
  return {
    allocations: [
      {
        allocationSide: 'source',
        sourceActivityFingerprint: pair.source.sourceActivityFingerprint,
        journalFingerprint: pair.source.journalFingerprint,
        postingFingerprint: pair.source.postingFingerprint,
        quantity: pair.target.amount,
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
      amount: pair.target.amount.toFixed(),
      assetIdentityReason: pair.assetIdentityResolution.reason,
      residualAmount: pair.residualAmount.toFixed(),
      residualSide: 'source',
      sourceAmount: pair.source.amount.toFixed(),
      sourceAssetId: pair.source.assetId,
      sourceBlockchainTransactionHash: sourceHash,
      sourcePlatformKey: pair.source.platformKey,
      sourcePostingFingerprint: pair.source.postingFingerprint,
      targetAmount: pair.target.amount.toFixed(),
      targetAssetId: pair.target.assetId,
      targetBlockchainTransactionHash: targetHash,
      targetPlatformKey: pair.target.platformKey,
      targetPostingFingerprint: pair.target.postingFingerprint,
      timeDistanceSeconds: pair.timeDistanceSeconds,
    },
    recognitionStrategy: LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY,
    relationshipStableKey: buildFeeAdjustedExactHashRelationshipStableKey(pair),
    relationshipKind: 'internal_transfer',
  };
}

function buildFeeAdjustedExactHashAssetIdentityBlocks(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): Result<LedgerFeeAdjustedExactHashAssetIdentityBlock[], Error> {
  const pairs = buildFeeAdjustedExactHashAssetIdentityBlockPairs(sources, targets, assetIdentityResolver);
  const sourceToTargets = groupCounterpartIds(pairs, 'source');
  const targetToSources = groupCounterpartIds(pairs, 'target');
  const blocks: LedgerFeeAdjustedExactHashAssetIdentityBlock[] = [];

  for (const pair of pairs) {
    if (
      sourceToTargets.get(pair.source.candidateId)?.length === 1 &&
      targetToSources.get(pair.target.candidateId)?.length === 1
    ) {
      const block = buildFeeAdjustedExactHashAssetIdentityBlock(pair);
      if (block.isErr()) {
        return err(block.error);
      }
      blocks.push(block.value);
    }
  }

  return ok(blocks.sort(compareAssetIdentityBlocks));
}

function buildFeeAdjustedExactHashAssetIdentityBlockPairs(
  sources: readonly LedgerTransferLinkingCandidate[],
  targets: readonly LedgerTransferLinkingCandidate[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): FeeAdjustedExactHashAssetIdentityBlockPair[] {
  const pairs: FeeAdjustedExactHashAssetIdentityBlockPair[] = [];

  for (const source of sources) {
    for (const target of targets) {
      if (source.assetId === target.assetId) {
        continue;
      }

      const shape = getFeeAdjustedExactHashShape(source, target);
      if (shape === undefined) {
        continue;
      }

      const resolution = assetIdentityResolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: source.assetId,
        targetAssetId: target.assetId,
      });
      if (resolution.status === 'accepted') {
        continue;
      }

      pairs.push({
        residualAmount: shape.residualAmount,
        source,
        target,
        timeDistanceSeconds: shape.timeDistanceSeconds,
      });
    }
  }

  return pairs;
}

function buildFeeAdjustedExactHashAssetIdentityBlock(
  pair: FeeAdjustedExactHashAssetIdentityBlockPair
): Result<LedgerFeeAdjustedExactHashAssetIdentityBlock, Error> {
  const sourceHash = pair.source.blockchainTransactionHash;
  const targetHash = pair.target.blockchainTransactionHash;
  if (sourceHash === undefined || targetHash === undefined) {
    return err(new Error('Cannot build fee-adjusted exact-hash asset identity block without hashes on both endpoints'));
  }

  return ok({
    amount: pair.target.amount.toFixed(),
    assetSymbol: pair.source.assetSymbol,
    reason: 'same_symbol_different_asset_ids',
    residualAmount: pair.residualAmount.toFixed(),
    residualSide: 'source',
    sourceAmount: pair.source.amount.toFixed(),
    sourceAssetId: pair.source.assetId,
    sourceBlockchainTransactionHash: sourceHash,
    sourceCandidateId: pair.source.candidateId,
    sourcePostingFingerprint: pair.source.postingFingerprint,
    targetAmount: pair.target.amount.toFixed(),
    targetAssetId: pair.target.assetId,
    targetBlockchainTransactionHash: targetHash,
    targetCandidateId: pair.target.candidateId,
    targetPostingFingerprint: pair.target.postingFingerprint,
    timeDistanceSeconds: pair.timeDistanceSeconds,
  });
}

function collectFeeAdjustedExactHashCandidateClaims(
  matches: readonly LedgerFeeAdjustedExactHashTransferMatch[]
): LedgerDeterministicCandidateClaim[] {
  const claims: LedgerDeterministicCandidateClaim[] = [];

  for (const match of matches) {
    const quantity = parseDecimal(match.amount);
    claims.push({ candidateId: match.sourceCandidateId, quantity }, { candidateId: match.targetCandidateId, quantity });
  }

  return claims.sort((left, right) => left.candidateId - right.candidateId);
}

function buildFeeAdjustedExactHashRelationshipStableKey(pair: FeeAdjustedExactHashPotentialPair): string {
  const payload = [
    'ledger-linking',
    LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY,
    'v1',
    pair.source.postingFingerprint,
    pair.target.postingFingerprint,
    pair.target.amount.toFixed(),
  ].join('\0');

  return `ledger-linking:${LEDGER_FEE_ADJUSTED_EXACT_HASH_TRANSFER_STRATEGY}:v1:${sha256Hex(payload).slice(0, 32)}`;
}

function compareFeeAdjustedExactHashMatches(
  left: LedgerFeeAdjustedExactHashTransferMatch,
  right: LedgerFeeAdjustedExactHashTransferMatch
): number {
  return (
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareAssetIdentityBlocks(
  left: LedgerFeeAdjustedExactHashAssetIdentityBlock,
  right: LedgerFeeAdjustedExactHashAssetIdentityBlock
): number {
  return (
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.sourceAssetId.localeCompare(right.sourceAssetId) ||
    left.targetAssetId.localeCompare(right.targetAssetId) ||
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
