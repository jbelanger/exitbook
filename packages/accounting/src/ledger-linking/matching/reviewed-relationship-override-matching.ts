import { CurrencySchema, DecimalSchema, err, ok, sha256Hex, type Result } from '@exitbook/foundation';
import { AccountingJournalRelationshipKindSchema } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';
import { z } from 'zod';

import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type {
  LedgerLinkingRelationshipAllocationDraft,
  LedgerLinkingRelationshipAllocationSide,
  LedgerLinkingRelationshipDraft,
} from '../relationships/relationship-materialization.js';

import type {
  LedgerDeterministicCandidateClaim,
  LedgerDeterministicRecognizer,
  LedgerDeterministicRecognizerResult,
} from './deterministic-recognizer-runner.js';

export const LEDGER_REVIEWED_RELATIONSHIP_STRATEGY = 'reviewed_relationship';

export const LedgerLinkingReviewedRelationshipAllocationOverrideSchema = z.object({
  allocationSide: z.enum(['source', 'target']),
  assetId: z.string().min(1, 'Asset ID must not be empty'),
  assetSymbol: CurrencySchema,
  journalFingerprint: z.string().min(1, 'Journal fingerprint must not be empty'),
  postingFingerprint: z.string().min(1, 'Posting fingerprint must not be empty'),
  quantity: DecimalSchema.refine((quantity) => quantity.gt(0), 'Reviewed allocation quantity must be positive'),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
});

export const LedgerLinkingReviewedRelationshipOverrideSchema = z
  .object({
    acceptedAt: z.string().datetime(),
    allocations: z
      .array(LedgerLinkingReviewedRelationshipAllocationOverrideSchema)
      .min(2, 'Reviewed relationship requires allocations'),
    evidence: z.record(z.string(), z.unknown()),
    overrideEventId: z.string().min(1, 'Override event ID must not be empty'),
    proposalKind: z.string().min(1, 'Proposal kind must not be empty'),
    relationshipKind: AccountingJournalRelationshipKindSchema,
    reviewId: z.string().min(1, 'Review ID must not be empty'),
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'source'), {
    message: 'Reviewed relationship requires at least one source allocation',
    path: ['allocations'],
  })
  .refine((relationship) => relationship.allocations.some((allocation) => allocation.allocationSide === 'target'), {
    message: 'Reviewed relationship requires at least one target allocation',
    path: ['allocations'],
  });

export type LedgerLinkingReviewedRelationshipAllocationOverride = z.infer<
  typeof LedgerLinkingReviewedRelationshipAllocationOverrideSchema
>;
export type LedgerLinkingReviewedRelationshipOverride = z.infer<typeof LedgerLinkingReviewedRelationshipOverrideSchema>;

export interface LedgerReviewedRelationshipOverrideAllocationMatch {
  allocationSide: LedgerLinkingRelationshipAllocationSide;
  candidateId: number;
  postingFingerprint: string;
  quantity: string;
}

export interface LedgerReviewedRelationshipOverrideMatch {
  allocations: readonly LedgerReviewedRelationshipOverrideAllocationMatch[];
  overrideEventId: string;
  relationshipStableKey: string;
  reviewId: string;
}

export interface LedgerReviewedRelationshipOverrideResult {
  matches: readonly LedgerReviewedRelationshipOverrideMatch[];
}

export interface ILedgerLinkingReviewedRelationshipOverrideReader {
  loadReviewedLedgerLinkingRelationshipOverrides(
    profileId: number
  ): Promise<Result<LedgerLinkingReviewedRelationshipOverride[], Error>>;
}

export function buildLedgerReviewedRelationshipOverrideRecognizer(
  reviewedOverrides: readonly LedgerLinkingReviewedRelationshipOverride[]
): LedgerDeterministicRecognizer<LedgerReviewedRelationshipOverrideResult> {
  return {
    name: LEDGER_REVIEWED_RELATIONSHIP_STRATEGY,
    recognize: (candidates) => buildLedgerReviewedRelationshipOverrides(candidates, reviewedOverrides),
  };
}

export function buildLedgerReviewedRelationshipOverrides(
  candidates: readonly LedgerTransferLinkingCandidate[],
  reviewedOverrides: readonly LedgerLinkingReviewedRelationshipOverride[]
): Result<LedgerDeterministicRecognizerResult<LedgerReviewedRelationshipOverrideResult>, Error> {
  const candidateClaims: LedgerDeterministicCandidateClaim[] = [];
  const matches: LedgerReviewedRelationshipOverrideMatch[] = [];
  const relationships: LedgerLinkingRelationshipDraft[] = [];
  const relationshipStableKeys = new Set<string>();

  for (const reviewedOverride of reviewedOverrides) {
    const validation = LedgerLinkingReviewedRelationshipOverrideSchema.safeParse(reviewedOverride);
    if (!validation.success) {
      return err(new Error(`Invalid reviewed ledger-linking relationship override: ${validation.error.message}`));
    }

    const accepted = validation.data;
    const allocationMatchesResult = resolveReviewedAllocationMatches(candidates, accepted);
    if (allocationMatchesResult.isErr()) {
      return err(allocationMatchesResult.error);
    }

    const relationshipStableKey = buildReviewedLedgerLinkingRelationshipStableKey(accepted);
    if (relationshipStableKeys.has(relationshipStableKey)) {
      return err(new Error(`Duplicate reviewed ledger-linking relationship override ${relationshipStableKey}`));
    }
    relationshipStableKeys.add(relationshipStableKey);

    for (const match of allocationMatchesResult.value) {
      candidateClaims.push({
        candidateId: match.candidate.candidateId,
        quantity: match.allocation.quantity,
      });
    }

    relationships.push(buildReviewedRelationshipDraft(accepted, relationshipStableKey));
    matches.push({
      allocations: allocationMatchesResult.value.map((match) => ({
        allocationSide: match.allocation.allocationSide,
        candidateId: match.candidate.candidateId,
        postingFingerprint: match.allocation.postingFingerprint,
        quantity: match.allocation.quantity.toFixed(),
      })),
      overrideEventId: accepted.overrideEventId,
      relationshipStableKey,
      reviewId: accepted.reviewId,
    });
  }

  return ok({
    candidateClaims,
    payload: {
      matches,
    },
    relationships,
  });
}

export function buildReviewedLedgerLinkingRelationshipStableKey(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride
): string {
  return `ledger-linking:${LEDGER_REVIEWED_RELATIONSHIP_STRATEGY}:v2:${sha256Hex(
    [
      reviewedOverride.relationshipKind,
      reviewedOverride.proposalKind,
      ...canonicalReviewedAllocations(reviewedOverride).map((allocation) =>
        [
          allocation.allocationSide,
          allocation.sourceActivityFingerprint,
          allocation.journalFingerprint,
          allocation.postingFingerprint,
          allocation.assetId,
          allocation.quantity.toFixed(),
        ].join('\u0001')
      ),
    ].join('\0')
  ).slice(0, 32)}`;
}

interface ReviewedAllocationMatch {
  allocation: LedgerLinkingReviewedRelationshipAllocationOverride;
  candidate: LedgerTransferLinkingCandidate;
}

function resolveReviewedAllocationMatches(
  candidates: readonly LedgerTransferLinkingCandidate[],
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride
): Result<ReviewedAllocationMatch[], Error> {
  const matches: ReviewedAllocationMatch[] = [];

  for (const allocation of reviewedOverride.allocations) {
    const candidateResult = findReviewedAllocationCandidate(candidates, reviewedOverride, allocation);
    if (candidateResult.isErr()) {
      return err(candidateResult.error);
    }

    const quantityValidation = validateReviewedAllocationQuantity(reviewedOverride, allocation, candidateResult.value);
    if (quantityValidation.isErr()) {
      return err(quantityValidation.error);
    }

    matches.push({
      allocation,
      candidate: candidateResult.value,
    });
  }

  return ok(matches);
}

function findReviewedAllocationCandidate(
  candidates: readonly LedgerTransferLinkingCandidate[],
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  allocation: LedgerLinkingReviewedRelationshipAllocationOverride
): Result<LedgerTransferLinkingCandidate, Error> {
  const candidate = candidates.find(
    (item) =>
      item.direction === allocation.allocationSide &&
      item.sourceActivityFingerprint === allocation.sourceActivityFingerprint &&
      item.journalFingerprint === allocation.journalFingerprint &&
      item.postingFingerprint === allocation.postingFingerprint
  );

  if (candidate === undefined) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} no longer resolves ${allocation.allocationSide} posting ${allocation.postingFingerprint}`
      )
    );
  }

  if (candidate.assetId !== allocation.assetId) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} ${allocation.allocationSide} posting ${allocation.postingFingerprint} asset changed from ${allocation.assetId} to ${candidate.assetId}`
      )
    );
  }

  return ok(candidate);
}

function validateReviewedAllocationQuantity(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  allocation: LedgerLinkingReviewedRelationshipAllocationOverride,
  candidate: LedgerTransferLinkingCandidate
): Result<void, Error> {
  if (allocation.quantity.gt(candidate.amount)) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} overclaims ${allocation.allocationSide} posting ${allocation.postingFingerprint}: ${allocation.quantity.toFixed()} of ${candidate.amount.toFixed()}`
      )
    );
  }

  return ok(undefined);
}

function buildReviewedRelationshipDraft(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  relationshipStableKey: string
): LedgerLinkingRelationshipDraft {
  return {
    allocations: reviewedOverride.allocations.map(toRelationshipAllocationDraft),
    confidenceScore: new Decimal(1),
    evidence: {
      acceptedAt: reviewedOverride.acceptedAt,
      overrideEventId: reviewedOverride.overrideEventId,
      proposalKind: reviewedOverride.proposalKind,
      reviewEvidence: reviewedOverride.evidence,
      reviewId: reviewedOverride.reviewId,
      reviewedAllocations: reviewedOverride.allocations.map((allocation) => ({
        allocationSide: allocation.allocationSide,
        assetId: allocation.assetId,
        assetSymbol: allocation.assetSymbol,
        journalFingerprint: allocation.journalFingerprint,
        postingFingerprint: allocation.postingFingerprint,
        quantity: allocation.quantity.toFixed(),
        sourceActivityFingerprint: allocation.sourceActivityFingerprint,
      })),
    },
    recognitionStrategy: LEDGER_REVIEWED_RELATIONSHIP_STRATEGY,
    relationshipKind: reviewedOverride.relationshipKind,
    relationshipStableKey,
  };
}

function toRelationshipAllocationDraft(
  allocation: LedgerLinkingReviewedRelationshipAllocationOverride
): LedgerLinkingRelationshipAllocationDraft {
  return {
    allocationSide: allocation.allocationSide,
    journalFingerprint: allocation.journalFingerprint,
    postingFingerprint: allocation.postingFingerprint,
    quantity: allocation.quantity,
    sourceActivityFingerprint: allocation.sourceActivityFingerprint,
  };
}

function canonicalReviewedAllocations(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride
): LedgerLinkingReviewedRelationshipAllocationOverride[] {
  return [...reviewedOverride.allocations].sort(
    (left, right) =>
      allocationSideRank(left.allocationSide) - allocationSideRank(right.allocationSide) ||
      left.sourceActivityFingerprint.localeCompare(right.sourceActivityFingerprint) ||
      left.journalFingerprint.localeCompare(right.journalFingerprint) ||
      left.postingFingerprint.localeCompare(right.postingFingerprint) ||
      left.assetId.localeCompare(right.assetId) ||
      left.quantity.cmp(right.quantity)
  );
}

function allocationSideRank(side: LedgerLinkingRelationshipAllocationSide): number {
  return side === 'source' ? 0 : 1;
}
