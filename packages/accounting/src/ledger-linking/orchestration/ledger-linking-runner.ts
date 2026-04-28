import { err, ok, type Result } from '@exitbook/foundation';

import {
  buildLedgerTransferLinkingCandidates,
  type ILedgerLinkingCandidateSourceReader,
  type LedgerLinkingCandidateSkip,
} from '../candidates/candidate-construction.js';
import {
  buildLedgerExactHashTransferRelationships,
  type LedgerExactHashTransferAmbiguity,
  type LedgerExactHashTransferMatch,
} from '../matching/deterministic-transfer-matching.js';
import type {
  ILedgerLinkingRelationshipStore,
  LedgerLinkingRelationshipDraft,
  LedgerLinkingRelationshipMaterializationResult,
} from '../relationships/relationship-materialization.js';

export interface LedgerLinkingRunPorts {
  candidateSourceReader: ILedgerLinkingCandidateSourceReader;
  relationshipStore: ILedgerLinkingRelationshipStore;
}

export interface LedgerLinkingRunOptions {
  dryRun?: boolean | undefined;
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
  exactHashAmbiguities: readonly LedgerExactHashTransferAmbiguity[];
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

  const { candidates, skipped } = candidateBuildResult.value;
  const exactHashResult = buildLedgerExactHashTransferRelationships(candidates);
  if (exactHashResult.isErr()) {
    return err(exactHashResult.error);
  }

  const matchCounts = countMatchedTransferCandidates(exactHashResult.value.matches);
  const candidateCounts = countTransferCandidatesByDirection(candidates);
  const persistenceResult = await resolvePersistenceResult(
    profileId,
    ports,
    exactHashResult.value.relationships,
    options
  );
  if (persistenceResult.isErr()) {
    return err(persistenceResult.error);
  }

  return ok({
    acceptedRelationships: exactHashResult.value.relationships,
    exactHashAmbiguities: exactHashResult.value.ambiguities,
    exactHashMatches: exactHashResult.value.matches,
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

function countTransferCandidatesByDirection(candidates: readonly { direction: 'source' | 'target' }[]): {
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

function countMatchedTransferCandidates(matches: readonly LedgerExactHashTransferMatch[]): {
  matchedSourceCandidateCount: number;
  matchedTargetCandidateCount: number;
} {
  return {
    matchedSourceCandidateCount: new Set(matches.map((match) => match.sourceCandidateId)).size,
    matchedTargetCandidateCount: new Set(matches.map((match) => match.targetCandidateId)).size,
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
