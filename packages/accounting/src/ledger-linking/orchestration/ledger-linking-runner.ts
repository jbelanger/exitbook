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
  postingInputCount: number;
  transferCandidateCount: number;
  sourceCandidateCount: number;
  targetCandidateCount: number;
  skippedCandidates: readonly LedgerLinkingCandidateSkip[];
  exactHashMatches: readonly LedgerExactHashTransferMatch[];
  exactHashAmbiguities: readonly LedgerExactHashTransferAmbiguity[];
  acceptedRelationships: readonly LedgerLinkingRelationshipDraft[];
  persistence: LedgerLinkingPersistenceResult;
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
    postingInputCount: postingInputsResult.value.length,
    transferCandidateCount: candidates.length,
    sourceCandidateCount: candidates.filter((candidate) => candidate.direction === 'source').length,
    targetCandidateCount: candidates.filter((candidate) => candidate.direction === 'target').length,
    skippedCandidates: skipped,
    exactHashMatches: exactHashResult.value.matches,
    exactHashAmbiguities: exactHashResult.value.ambiguities,
    acceptedRelationships: exactHashResult.value.relationships,
    persistence: persistenceResult.value,
  });
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
