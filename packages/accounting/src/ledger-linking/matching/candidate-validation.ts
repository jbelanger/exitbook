import { err, ok, type Result } from '@exitbook/foundation';

import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';

export function validateLedgerTransferLinkingCandidates(
  candidates: readonly LedgerTransferLinkingCandidate[]
): Result<void, Error> {
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
