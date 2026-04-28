import { err, ok, type Result } from '@exitbook/foundation';

import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

export interface LedgerDeterministicRecognizer<TPayload> {
  readonly name: string;
  recognize(
    candidates: readonly LedgerTransferLinkingCandidate[]
  ): Result<LedgerDeterministicRecognizerResult<TPayload>, Error>;
}

export interface LedgerDeterministicRecognizerResult<TPayload> {
  readonly consumedCandidateIds: readonly number[];
  readonly payload: TPayload;
  readonly relationships: readonly LedgerLinkingRelationshipDraft[];
}

export interface LedgerDeterministicRecognizerRun<TPayload> {
  readonly consumedCandidateIds: readonly number[];
  readonly name: string;
  readonly payload: TPayload;
  readonly relationshipCount: number;
}

export interface LedgerDeterministicRecognizerPipelineResult<TPayload> {
  readonly consumedCandidateIds: readonly number[];
  readonly relationships: readonly LedgerLinkingRelationshipDraft[];
  readonly runs: readonly LedgerDeterministicRecognizerRun<TPayload>[];
}

export function runLedgerDeterministicRecognizers<TPayload>(
  candidates: readonly LedgerTransferLinkingCandidate[],
  recognizers: readonly LedgerDeterministicRecognizer<TPayload>[]
): Result<LedgerDeterministicRecognizerPipelineResult<TPayload>, Error> {
  const consumedCandidateIds = new Set<number>();
  const relationships: LedgerLinkingRelationshipDraft[] = [];
  const runs: LedgerDeterministicRecognizerRun<TPayload>[] = [];

  for (const recognizer of recognizers) {
    const availableCandidates = candidates.filter((candidate) => !consumedCandidateIds.has(candidate.candidateId));
    const recognition = recognizer.recognize(availableCandidates);
    if (recognition.isErr()) {
      return err(recognition.error);
    }

    const claimedIdsResult = validateRecognizerClaims(
      recognizer.name,
      recognition.value.consumedCandidateIds,
      availableCandidates
    );
    if (claimedIdsResult.isErr()) {
      return err(claimedIdsResult.error);
    }

    for (const candidateId of claimedIdsResult.value) {
      consumedCandidateIds.add(candidateId);
    }

    relationships.push(...recognition.value.relationships);
    runs.push({
      consumedCandidateIds: claimedIdsResult.value,
      name: recognizer.name,
      payload: recognition.value.payload,
      relationshipCount: recognition.value.relationships.length,
    });
  }

  return ok({
    consumedCandidateIds: [...consumedCandidateIds].sort(compareNumbers),
    relationships,
    runs,
  });
}

function validateRecognizerClaims(
  recognizerName: string,
  consumedCandidateIds: readonly number[],
  availableCandidates: readonly LedgerTransferLinkingCandidate[]
): Result<number[], Error> {
  const availableCandidateIds = new Set(availableCandidates.map((candidate) => candidate.candidateId));
  const claimedCandidateIds = new Set<number>();

  for (const candidateId of consumedCandidateIds) {
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return err(
        new Error(`Ledger deterministic recognizer ${recognizerName} claimed invalid candidate id ${candidateId}`)
      );
    }

    if (claimedCandidateIds.has(candidateId)) {
      return err(
        new Error(`Ledger deterministic recognizer ${recognizerName} claimed candidate ${candidateId} more than once`)
      );
    }

    if (!availableCandidateIds.has(candidateId)) {
      return err(
        new Error(`Ledger deterministic recognizer ${recognizerName} claimed unavailable candidate ${candidateId}`)
      );
    }

    claimedCandidateIds.add(candidateId);
  }

  return ok([...claimedCandidateIds].sort(compareNumbers));
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
