import { err, ok, type Result } from '@exitbook/foundation';

import {
  buildLedgerLinkingAssetIdentityResolver,
  type ILedgerLinkingAssetIdentityAssertionReader,
} from '../asset-identity/asset-identity-resolution.js';
import {
  buildLedgerTransferLinkingCandidates,
  type ILedgerLinkingCandidateSourceReader,
  type LedgerLinkingCandidateSkip,
} from '../candidates/candidate-construction.js';
import {
  runLedgerDeterministicRecognizers,
  type LedgerDeterministicRecognizerRun,
} from '../matching/deterministic-recognizer-runner.js';
import {
  buildLedgerExactHashTransferRecognizer,
  LEDGER_EXACT_HASH_TRANSFER_STRATEGY,
  type LedgerExactHashAssetIdentityBlock,
  type LedgerExactHashTransferAmbiguity,
  type LedgerExactHashTransferMatch,
  type LedgerExactHashTransferRelationshipResult,
} from '../matching/deterministic-transfer-matching.js';
import type {
  ILedgerLinkingRelationshipStore,
  LedgerLinkingRelationshipDraft,
  LedgerLinkingRelationshipMaterializationResult,
} from '../relationships/relationship-materialization.js';

export interface LedgerLinkingRunPorts {
  assetIdentityAssertionReader: ILedgerLinkingAssetIdentityAssertionReader;
  candidateSourceReader: ILedgerLinkingCandidateSourceReader;
  relationshipStore: ILedgerLinkingRelationshipStore;
}

interface LedgerTransferCandidateDirection {
  candidateId: number;
  direction: 'source' | 'target';
}

export interface LedgerLinkingRunOptions {
  dryRun?: boolean | undefined;
}

export interface LedgerLinkingDeterministicRecognizerStats {
  consumedCandidateCount: number;
  name: string;
  relationshipCount: number;
}

export type LedgerLinkingPersistenceResult =
  | {
      mode: 'dry_run';
      plannedRelationshipCount: number;
    }
  | {
      materialization: LedgerLinkingRelationshipMaterializationResult;
      mode: 'persisted';
    };

export interface LedgerLinkingRunResult {
  acceptedRelationships: readonly LedgerLinkingRelationshipDraft[];
  deterministicRecognizerStats: readonly LedgerLinkingDeterministicRecognizerStats[];
  exactHashAmbiguities: readonly LedgerExactHashTransferAmbiguity[];
  exactHashAssetIdentityBlocks: readonly LedgerExactHashAssetIdentityBlock[];
  exactHashMatches: readonly LedgerExactHashTransferMatch[];
  matchedSourceCandidateCount: number;
  matchedTargetCandidateCount: number;
  persistence: LedgerLinkingPersistenceResult;
  postingInputCount: number;
  skippedCandidates: readonly LedgerLinkingCandidateSkip[];
  sourceCandidateCount: number;
  targetCandidateCount: number;
  transferCandidateCount: number;
  unmatchedSourceCandidateCount: number;
  unmatchedTargetCandidateCount: number;
}

export async function runLedgerLinking(
  profileId: number,
  ports: LedgerLinkingRunPorts,
  options: LedgerLinkingRunOptions = {}
): Promise<Result<LedgerLinkingRunResult, Error>> {
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
  }

  const postingInputsResult = await ports.candidateSourceReader.loadLedgerLinkingPostingInputs(profileId);
  if (postingInputsResult.isErr()) {
    return err(postingInputsResult.error);
  }

  const candidateBuildResult = buildLedgerTransferLinkingCandidates(postingInputsResult.value);
  if (candidateBuildResult.isErr()) {
    return err(candidateBuildResult.error);
  }

  const assetIdentityAssertionsResult =
    await ports.assetIdentityAssertionReader.loadLedgerLinkingAssetIdentityAssertions(profileId);
  if (assetIdentityAssertionsResult.isErr()) {
    return err(assetIdentityAssertionsResult.error);
  }

  const assetIdentityResolverResult = buildLedgerLinkingAssetIdentityResolver(assetIdentityAssertionsResult.value);
  if (assetIdentityResolverResult.isErr()) {
    return err(assetIdentityResolverResult.error);
  }

  const { candidates, skipped } = candidateBuildResult.value;
  const deterministicResult = runLedgerDeterministicRecognizers(candidates, [
    buildLedgerExactHashTransferRecognizer(assetIdentityResolverResult.value),
  ]);
  if (deterministicResult.isErr()) {
    return err(deterministicResult.error);
  }

  const exactHashRun = findExactHashRun(deterministicResult.value.runs);
  if (exactHashRun.isErr()) {
    return err(exactHashRun.error);
  }
  const exactHashResult = exactHashRun.value.payload;
  const matchCounts = countMatchedTransferCandidates(candidates, deterministicResult.value.consumedCandidateIds);
  const candidateCounts = countTransferCandidatesByDirection(candidates);
  const persistenceResult = await resolvePersistenceResult(
    profileId,
    ports,
    deterministicResult.value.relationships,
    options
  );
  if (persistenceResult.isErr()) {
    return err(persistenceResult.error);
  }

  return ok({
    acceptedRelationships: deterministicResult.value.relationships,
    deterministicRecognizerStats: deterministicResult.value.runs.map(toDeterministicRecognizerStats),
    exactHashAmbiguities: exactHashResult.ambiguities,
    exactHashAssetIdentityBlocks: exactHashResult.assetIdentityBlocks,
    exactHashMatches: exactHashResult.matches,
    matchedSourceCandidateCount: matchCounts.matchedSourceCandidateCount,
    matchedTargetCandidateCount: matchCounts.matchedTargetCandidateCount,
    persistence: persistenceResult.value,
    postingInputCount: postingInputsResult.value.length,
    skippedCandidates: skipped,
    sourceCandidateCount: candidateCounts.sourceCandidateCount,
    targetCandidateCount: candidateCounts.targetCandidateCount,
    transferCandidateCount: candidates.length,
    unmatchedSourceCandidateCount: candidateCounts.sourceCandidateCount - matchCounts.matchedSourceCandidateCount,
    unmatchedTargetCandidateCount: candidateCounts.targetCandidateCount - matchCounts.matchedTargetCandidateCount,
  });
}

function findExactHashRun(
  runs: readonly LedgerDeterministicRecognizerRun<LedgerExactHashTransferRelationshipResult>[]
): Result<LedgerDeterministicRecognizerRun<LedgerExactHashTransferRelationshipResult>, Error> {
  const run = runs.find((candidateRun) => candidateRun.name === LEDGER_EXACT_HASH_TRANSFER_STRATEGY);
  if (run === undefined) {
    return err(new Error(`Ledger deterministic recognizer ${LEDGER_EXACT_HASH_TRANSFER_STRATEGY} did not run`));
  }

  return ok(run);
}

function toDeterministicRecognizerStats(
  run: LedgerDeterministicRecognizerRun<unknown>
): LedgerLinkingDeterministicRecognizerStats {
  return {
    consumedCandidateCount: run.consumedCandidateIds.length,
    name: run.name,
    relationshipCount: run.relationshipCount,
  };
}

function countTransferCandidatesByDirection(candidates: readonly LedgerTransferCandidateDirection[]): {
  sourceCandidateCount: number;
  targetCandidateCount: number;
} {
  let sourceCandidateCount = 0;
  let targetCandidateCount = 0;

  for (const candidate of candidates) {
    if (candidate.direction === 'source') {
      sourceCandidateCount++;
    } else {
      targetCandidateCount++;
    }
  }

  return {
    sourceCandidateCount,
    targetCandidateCount,
  };
}

function countMatchedTransferCandidates(
  candidates: readonly LedgerTransferCandidateDirection[],
  consumedCandidateIds: readonly number[]
): {
  matchedSourceCandidateCount: number;
  matchedTargetCandidateCount: number;
} {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  let matchedSourceCandidateCount = 0;
  let matchedTargetCandidateCount = 0;

  for (const candidateId of consumedCandidateIds) {
    const candidate = candidatesById.get(candidateId);
    if (candidate?.direction === 'source') {
      matchedSourceCandidateCount++;
    } else if (candidate?.direction === 'target') {
      matchedTargetCandidateCount++;
    }
  }

  return {
    matchedSourceCandidateCount,
    matchedTargetCandidateCount,
  };
}

async function resolvePersistenceResult(
  profileId: number,
  ports: LedgerLinkingRunPorts,
  relationships: readonly LedgerLinkingRelationshipDraft[],
  options: LedgerLinkingRunOptions
): Promise<Result<LedgerLinkingPersistenceResult, Error>> {
  if (options.dryRun === true) {
    return ok({
      mode: 'dry_run',
      plannedRelationshipCount: relationships.length,
    });
  }

  const materializationResult = await ports.relationshipStore.replaceLedgerLinkingRelationships(
    profileId,
    relationships
  );
  if (materializationResult.isErr()) {
    return err(materializationResult.error);
  }

  return ok({
    mode: 'persisted',
    materialization: materializationResult.value,
  });
}
