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

export interface LedgerLinkingRunResult {
  postingInputCount: number;
  transferCandidateCount: number;
  sourceCandidateCount: number;
  targetCandidateCount: number;
  skippedCandidates: readonly LedgerLinkingCandidateSkip[];
  exactHashMatches: readonly LedgerExactHashTransferMatch[];
  exactHashAmbiguities: readonly LedgerExactHashTransferAmbiguity[];
  acceptedRelationships: readonly LedgerLinkingRelationshipDraft[];
  materialization: LedgerLinkingRelationshipMaterializationResult;
}

export async function runLedgerLinking(
  profileId: number,
  ports: LedgerLinkingRunPorts
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

  const materializationResult = await ports.relationshipStore.replaceLedgerLinkingRelationships(
    profileId,
    exactHashResult.value.relationships
  );
  if (materializationResult.isErr()) {
    return err(materializationResult.error);
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
    materialization: materializationResult.value,
  });
}
