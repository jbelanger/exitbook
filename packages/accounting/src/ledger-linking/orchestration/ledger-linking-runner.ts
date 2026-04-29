import { err, ok, type Result } from '@exitbook/foundation';

import {
  buildLedgerLinkingAssetIdentityResolver,
  type ILedgerLinkingAssetIdentityAssertionReader,
} from '../asset-identity/asset-identity-resolution.js';
import {
  buildLedgerLinkingAssetIdentitySuggestions,
  buildLedgerLinkingAssetIdentitySuggestionsFromDiagnostics,
  type LedgerLinkingAssetIdentitySuggestion,
} from '../asset-identity/asset-identity-suggestions.js';
import {
  buildLedgerTransferLinkingCandidates,
  type ILedgerLinkingCandidateSourceReader,
  type LedgerLinkingCandidateSkip,
} from '../candidates/candidate-construction.js';
import { buildLedgerLinkingDiagnostics, type LedgerLinkingDiagnostics } from '../diagnostics/linking-diagnostics.js';
import {
  buildLedgerCounterpartyRoundtripRecognizer,
  LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY,
  type LedgerCounterpartyRoundtripAmbiguity,
  type LedgerCounterpartyRoundtripMatch,
  type LedgerCounterpartyRoundtripRelationshipResult,
} from '../matching/counterparty-roundtrip-matching.js';
import {
  runLedgerDeterministicRecognizers,
  type LedgerDeterministicCandidateClaim,
  type LedgerDeterministicRecognizer,
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
import {
  buildLedgerSameHashGroupedTransferRecognizer,
  LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY,
  type LedgerSameHashGroupedTransferMatch,
  type LedgerSameHashGroupedTransferRelationshipResult,
  type LedgerSameHashGroupedTransferUnresolvedGroup,
} from '../matching/same-hash-grouped-transfer-matching.js';
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

type LedgerLinkingDeterministicPayload =
  | LedgerExactHashTransferRelationshipResult
  | LedgerSameHashGroupedTransferRelationshipResult
  | LedgerCounterpartyRoundtripRelationshipResult;

export interface LedgerLinkingRunOptions {
  amountTimeProposalWindowMinutes?: number | undefined;
  dryRun?: boolean | undefined;
  includeDiagnostics?: boolean | undefined;
}

export interface LedgerLinkingDeterministicRecognizerStats {
  claimedCandidateCount: number;
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
  assetIdentitySuggestions: readonly LedgerLinkingAssetIdentitySuggestion[];
  counterpartyRoundtripAmbiguities: readonly LedgerCounterpartyRoundtripAmbiguity[];
  counterpartyRoundtripMatches: readonly LedgerCounterpartyRoundtripMatch[];
  deterministicRecognizerStats: readonly LedgerLinkingDeterministicRecognizerStats[];
  diagnostics?: LedgerLinkingDiagnostics | undefined;
  exactHashAmbiguities: readonly LedgerExactHashTransferAmbiguity[];
  exactHashAssetIdentityBlocks: readonly LedgerExactHashAssetIdentityBlock[];
  exactHashMatches: readonly LedgerExactHashTransferMatch[];
  matchedSourceCandidateCount: number;
  matchedTargetCandidateCount: number;
  persistence: LedgerLinkingPersistenceResult;
  postingInputCount: number;
  sameHashGroupedMatches: readonly LedgerSameHashGroupedTransferMatch[];
  sameHashGroupedUnresolvedGroups: readonly LedgerSameHashGroupedTransferUnresolvedGroup[];
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
  const deterministicRecognizers: LedgerDeterministicRecognizer<LedgerLinkingDeterministicPayload>[] = [
    buildLedgerExactHashTransferRecognizer(
      assetIdentityResolverResult.value
    ) as LedgerDeterministicRecognizer<LedgerLinkingDeterministicPayload>,
    buildLedgerSameHashGroupedTransferRecognizer(
      assetIdentityResolverResult.value
    ) as LedgerDeterministicRecognizer<LedgerLinkingDeterministicPayload>,
    buildLedgerCounterpartyRoundtripRecognizer(
      assetIdentityResolverResult.value
    ) as LedgerDeterministicRecognizer<LedgerLinkingDeterministicPayload>,
  ];
  const deterministicResult = runLedgerDeterministicRecognizers(candidates, deterministicRecognizers);
  if (deterministicResult.isErr()) {
    return err(deterministicResult.error);
  }

  const exactHashRun = findExactHashRun(deterministicResult.value.runs);
  if (exactHashRun.isErr()) {
    return err(exactHashRun.error);
  }
  const exactHashResult = exactHashRun.value.payload;
  const sameHashRun = findSameHashGroupedRun(deterministicResult.value.runs);
  if (sameHashRun.isErr()) {
    return err(sameHashRun.error);
  }
  const sameHashResult = sameHashRun.value.payload;
  const counterpartyRoundtripRun = findCounterpartyRoundtripRun(deterministicResult.value.runs);
  if (counterpartyRoundtripRun.isErr()) {
    return err(counterpartyRoundtripRun.error);
  }
  const counterpartyRoundtripResult = counterpartyRoundtripRun.value.payload;
  const diagnosticsResult = buildLedgerLinkingDiagnostics(
    candidates,
    deterministicResult.value.candidateClaims,
    assetIdentityResolverResult.value,
    {
      amountTimeWindowMinutes: options.amountTimeProposalWindowMinutes,
    }
  );
  if (diagnosticsResult.isErr()) {
    return err(diagnosticsResult.error);
  }

  const assetIdentitySuggestionsResult = buildRunAssetIdentitySuggestions(
    exactHashResult.assetIdentityBlocks,
    diagnosticsResult.value
  );
  if (assetIdentitySuggestionsResult.isErr()) {
    return err(assetIdentitySuggestionsResult.error);
  }

  const matchCounts = countMatchedTransferCandidates(candidates, deterministicResult.value.candidateClaims);
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
    assetIdentitySuggestions: assetIdentitySuggestionsResult.value,
    counterpartyRoundtripAmbiguities: counterpartyRoundtripResult.ambiguities,
    counterpartyRoundtripMatches: counterpartyRoundtripResult.matches,
    deterministicRecognizerStats: deterministicResult.value.runs.map(toDeterministicRecognizerStats),
    ...(options.includeDiagnostics === true ? { diagnostics: diagnosticsResult.value } : {}),
    exactHashAmbiguities: exactHashResult.ambiguities,
    exactHashAssetIdentityBlocks: exactHashResult.assetIdentityBlocks,
    exactHashMatches: exactHashResult.matches,
    matchedSourceCandidateCount: matchCounts.matchedSourceCandidateCount,
    matchedTargetCandidateCount: matchCounts.matchedTargetCandidateCount,
    persistence: persistenceResult.value,
    postingInputCount: postingInputsResult.value.length,
    sameHashGroupedMatches: sameHashResult.matches,
    sameHashGroupedUnresolvedGroups: sameHashResult.unresolvedGroups,
    skippedCandidates: skipped,
    sourceCandidateCount: candidateCounts.sourceCandidateCount,
    targetCandidateCount: candidateCounts.targetCandidateCount,
    transferCandidateCount: candidates.length,
    unmatchedSourceCandidateCount: candidateCounts.sourceCandidateCount - matchCounts.matchedSourceCandidateCount,
    unmatchedTargetCandidateCount: candidateCounts.targetCandidateCount - matchCounts.matchedTargetCandidateCount,
  });
}

function buildRunAssetIdentitySuggestions(
  exactHashAssetIdentityBlocks: readonly LedgerExactHashAssetIdentityBlock[],
  diagnostics: LedgerLinkingDiagnostics
): Result<LedgerLinkingAssetIdentitySuggestion[], Error> {
  const exactHashSuggestions = buildLedgerLinkingAssetIdentitySuggestions(exactHashAssetIdentityBlocks, {
    evidenceKind: 'exact_hash_observed',
  });
  if (exactHashSuggestions.isErr()) {
    return err(exactHashSuggestions.error);
  }

  const exactHashCandidatePairKeys = new Set(
    exactHashAssetIdentityBlocks.map((block) =>
      buildSourceTargetCandidatePairKey(block.sourceCandidateId, block.targetCandidateId)
    )
  );
  const diagnosticAssetIdentityBlockerProposals = diagnostics.assetIdentityBlockerProposals.filter(
    (proposal) =>
      !exactHashCandidatePairKeys.has(
        buildSourceTargetCandidatePairKey(proposal.source.candidateId, proposal.target.candidateId)
      )
  );

  const diagnosticSuggestions = buildLedgerLinkingAssetIdentitySuggestionsFromDiagnostics({
    ...diagnostics,
    assetIdentityBlockerProposalCount: diagnosticAssetIdentityBlockerProposals.length,
    assetIdentityBlockerProposals: diagnosticAssetIdentityBlockerProposals,
  });
  if (diagnosticSuggestions.isErr()) {
    return err(diagnosticSuggestions.error);
  }

  return ok([...exactHashSuggestions.value, ...diagnosticSuggestions.value].sort(compareAssetIdentitySuggestions));
}

function buildSourceTargetCandidatePairKey(sourceCandidateId: number, targetCandidateId: number): string {
  return `${sourceCandidateId}\0${targetCandidateId}`;
}

function compareAssetIdentitySuggestions(
  left: LedgerLinkingAssetIdentitySuggestion,
  right: LedgerLinkingAssetIdentitySuggestion
): number {
  return (
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    assetIdentitySuggestionEvidenceKindRank(left.evidenceKind) -
      assetIdentitySuggestionEvidenceKindRank(right.evidenceKind) ||
    left.relationshipKind.localeCompare(right.relationshipKind) ||
    left.assetIdA.localeCompare(right.assetIdA) ||
    left.assetIdB.localeCompare(right.assetIdB)
  );
}

function assetIdentitySuggestionEvidenceKindRank(
  evidenceKind: LedgerLinkingAssetIdentitySuggestion['evidenceKind']
): number {
  switch (evidenceKind) {
    case 'exact_hash_observed':
      return 0;
    case 'amount_time_observed':
      return 1;
  }
}

function findExactHashRun(
  runs: readonly LedgerDeterministicRecognizerRun<LedgerLinkingDeterministicPayload>[]
): Result<LedgerDeterministicRecognizerRun<LedgerExactHashTransferRelationshipResult>, Error> {
  const run = runs.find((candidateRun) => candidateRun.name === LEDGER_EXACT_HASH_TRANSFER_STRATEGY);
  if (run === undefined) {
    return err(new Error(`Ledger deterministic recognizer ${LEDGER_EXACT_HASH_TRANSFER_STRATEGY} did not run`));
  }

  return ok(run as LedgerDeterministicRecognizerRun<LedgerExactHashTransferRelationshipResult>);
}

function findSameHashGroupedRun(
  runs: readonly LedgerDeterministicRecognizerRun<LedgerLinkingDeterministicPayload>[]
): Result<LedgerDeterministicRecognizerRun<LedgerSameHashGroupedTransferRelationshipResult>, Error> {
  const run = runs.find((candidateRun) => candidateRun.name === LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY);
  if (run === undefined) {
    return err(new Error(`Ledger deterministic recognizer ${LEDGER_SAME_HASH_GROUPED_TRANSFER_STRATEGY} did not run`));
  }

  return ok(run as LedgerDeterministicRecognizerRun<LedgerSameHashGroupedTransferRelationshipResult>);
}

function findCounterpartyRoundtripRun(
  runs: readonly LedgerDeterministicRecognizerRun<LedgerLinkingDeterministicPayload>[]
): Result<LedgerDeterministicRecognizerRun<LedgerCounterpartyRoundtripRelationshipResult>, Error> {
  const run = runs.find((candidateRun) => candidateRun.name === LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY);
  if (run === undefined) {
    return err(new Error(`Ledger deterministic recognizer ${LEDGER_COUNTERPARTY_ROUNDTRIP_STRATEGY} did not run`));
  }

  return ok(run as LedgerDeterministicRecognizerRun<LedgerCounterpartyRoundtripRelationshipResult>);
}

function toDeterministicRecognizerStats(
  run: LedgerDeterministicRecognizerRun<unknown>
): LedgerLinkingDeterministicRecognizerStats {
  return {
    claimedCandidateCount: new Set(run.candidateClaims.map((claim) => claim.candidateId)).size,
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
  candidateClaims: readonly Pick<LedgerDeterministicCandidateClaim, 'candidateId'>[]
): {
  matchedSourceCandidateCount: number;
  matchedTargetCandidateCount: number;
} {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const matchedCandidateIds = new Set(candidateClaims.map((claim) => claim.candidateId));
  let matchedSourceCandidateCount = 0;
  let matchedTargetCandidateCount = 0;

  for (const candidateId of matchedCandidateIds) {
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
