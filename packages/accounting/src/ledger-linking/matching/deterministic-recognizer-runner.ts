import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

export interface LedgerDeterministicRecognizer<TPayload> {
  readonly name: string;
  recognize(
    candidates: readonly LedgerTransferLinkingCandidate[]
  ): Result<LedgerDeterministicRecognizerResult<TPayload>, Error>;
}

export interface LedgerDeterministicCandidateClaim {
  readonly candidateId: number;
  readonly quantity: Decimal;
}

export interface LedgerDeterministicRecognizerResult<TPayload> {
  readonly candidateClaims: readonly LedgerDeterministicCandidateClaim[];
  readonly payload: TPayload;
  readonly relationships: readonly LedgerLinkingRelationshipDraft[];
}

export interface LedgerDeterministicRecognizerRun<TPayload> {
  readonly candidateClaims: readonly LedgerDeterministicCandidateClaim[];
  readonly consumedCandidateIds: readonly number[];
  readonly name: string;
  readonly payload: TPayload;
  readonly relationshipCount: number;
}

export interface LedgerDeterministicRecognizerPipelineResult<TPayload> {
  readonly candidateClaims: readonly LedgerDeterministicCandidateClaim[];
  readonly consumedCandidateIds: readonly number[];
  readonly relationships: readonly LedgerLinkingRelationshipDraft[];
  readonly runs: readonly LedgerDeterministicRecognizerRun<TPayload>[];
}

export function runLedgerDeterministicRecognizers<TPayload>(
  candidates: readonly LedgerTransferLinkingCandidate[],
  recognizers: readonly LedgerDeterministicRecognizer<TPayload>[]
): Result<LedgerDeterministicRecognizerPipelineResult<TPayload>, Error> {
  const consumedCandidateIds = new Set<number>();
  const claimedQuantitiesByCandidateId = new Map<number, Decimal>();
  const candidateClaims: LedgerDeterministicCandidateClaim[] = [];
  const relationships: LedgerLinkingRelationshipDraft[] = [];
  const runs: LedgerDeterministicRecognizerRun<TPayload>[] = [];

  for (const recognizer of recognizers) {
    const availableCandidatesResult = buildAvailableCandidates(candidates, claimedQuantitiesByCandidateId);
    if (availableCandidatesResult.isErr()) {
      return err(availableCandidatesResult.error);
    }

    const availableCandidates = availableCandidatesResult.value;
    const recognition = recognizer.recognize(availableCandidates);
    if (recognition.isErr()) {
      return err(recognition.error);
    }

    const claimsResult = validateRecognizerClaims(
      recognizer.name,
      recognition.value.candidateClaims,
      availableCandidates
    );
    if (claimsResult.isErr()) {
      return err(claimsResult.error);
    }

    const runConsumedCandidateIds: number[] = [];
    for (const claim of claimsResult.value) {
      const originalCandidate = candidates.find((candidate) => candidate.candidateId === claim.candidateId);
      if (originalCandidate === undefined) {
        return err(new Error(`Ledger deterministic recognizer ${recognizer.name} claimed unknown candidate`));
      }

      const totalClaimedQuantity = (claimedQuantitiesByCandidateId.get(claim.candidateId) ?? new Decimal(0)).plus(
        claim.quantity
      );
      claimedQuantitiesByCandidateId.set(claim.candidateId, totalClaimedQuantity);
      candidateClaims.push(claim);

      if (totalClaimedQuantity.eq(originalCandidate.amount)) {
        consumedCandidateIds.add(claim.candidateId);
        runConsumedCandidateIds.push(claim.candidateId);
      }
    }

    relationships.push(...recognition.value.relationships);
    runs.push({
      candidateClaims: claimsResult.value,
      consumedCandidateIds: [...new Set(runConsumedCandidateIds)].sort(compareNumbers),
      name: recognizer.name,
      payload: recognition.value.payload,
      relationshipCount: recognition.value.relationships.length,
    });
  }

  return ok({
    candidateClaims: sortCandidateClaims(candidateClaims),
    consumedCandidateIds: [...consumedCandidateIds].sort(compareNumbers),
    relationships,
    runs,
  });
}

export function buildFullCandidateClaims(
  candidates: readonly LedgerTransferLinkingCandidate[],
  candidateIds: readonly number[]
): Result<LedgerDeterministicCandidateClaim[], Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const claims: LedgerDeterministicCandidateClaim[] = [];

  for (const candidateId of candidateIds) {
    const candidate = candidatesById.get(candidateId);
    if (candidate === undefined) {
      return err(new Error(`Cannot build full candidate claim for unknown candidate ${candidateId}`));
    }

    claims.push({
      candidateId,
      quantity: candidate.amount,
    });
  }

  return ok(sortCandidateClaims(claims));
}

function validateRecognizerClaims(
  recognizerName: string,
  candidateClaims: readonly LedgerDeterministicCandidateClaim[],
  availableCandidates: readonly LedgerTransferLinkingCandidate[]
): Result<LedgerDeterministicCandidateClaim[], Error> {
  const availableCandidatesById = new Map(availableCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const claimedQuantitiesByCandidateId = new Map<number, Decimal>();

  for (const claim of candidateClaims) {
    const { candidateId } = claim;
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return err(
        new Error(`Ledger deterministic recognizer ${recognizerName} claimed invalid candidate id ${candidateId}`)
      );
    }

    const availableCandidate = availableCandidatesById.get(candidateId);
    if (availableCandidate === undefined) {
      return err(
        new Error(`Ledger deterministic recognizer ${recognizerName} claimed unavailable candidate ${candidateId}`)
      );
    }

    if (!(claim.quantity instanceof Decimal)) {
      return err(
        new Error(
          `Ledger deterministic recognizer ${recognizerName} claimed invalid quantity for candidate ${candidateId}`
        )
      );
    }

    if (!claim.quantity.gt(0)) {
      return err(
        new Error(
          `Ledger deterministic recognizer ${recognizerName} claimed non-positive quantity ${claim.quantity.toFixed()} for candidate ${candidateId}`
        )
      );
    }

    const totalClaimedQuantity = (claimedQuantitiesByCandidateId.get(candidateId) ?? new Decimal(0)).plus(
      claim.quantity
    );
    if (totalClaimedQuantity.gt(availableCandidate.amount)) {
      return err(
        new Error(
          `Ledger deterministic recognizer ${recognizerName} overclaimed candidate ${candidateId}: claimed ${totalClaimedQuantity.toFixed()} of available ${availableCandidate.amount.toFixed()}`
        )
      );
    }

    claimedQuantitiesByCandidateId.set(candidateId, totalClaimedQuantity);
  }

  return ok(
    sortCandidateClaims(
      [...claimedQuantitiesByCandidateId.entries()].map(([candidateId, quantity]) => ({ candidateId, quantity }))
    )
  );
}

function buildAvailableCandidates(
  candidates: readonly LedgerTransferLinkingCandidate[],
  claimedQuantitiesByCandidateId: ReadonlyMap<number, Decimal>
): Result<LedgerTransferLinkingCandidate[], Error> {
  const availableCandidates: LedgerTransferLinkingCandidate[] = [];

  for (const candidate of candidates) {
    const claimedQuantity = claimedQuantitiesByCandidateId.get(candidate.candidateId) ?? new Decimal(0);
    const remainingAmount = candidate.amount.minus(claimedQuantity);

    if (remainingAmount.lt(0)) {
      return err(
        new Error(
          `Ledger deterministic recognizer pipeline overclaimed candidate ${candidate.candidateId}: remaining amount ${remainingAmount.toFixed()}`
        )
      );
    }

    if (remainingAmount.gt(0)) {
      availableCandidates.push(
        remainingAmount.eq(candidate.amount)
          ? candidate
          : {
              ...candidate,
              amount: remainingAmount,
            }
      );
    }
  }

  return ok(availableCandidates);
}

function sortCandidateClaims(
  claims: readonly LedgerDeterministicCandidateClaim[]
): LedgerDeterministicCandidateClaim[] {
  return [...claims].sort((left, right) => left.candidateId - right.candidateId);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
