import { DecimalSchema, err, ok, sha256Hex, type Result } from '@exitbook/foundation';
import { AccountingJournalRelationshipKindSchema } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';
import { z } from 'zod';

import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerLinkingRelationshipDraft } from '../relationships/relationship-materialization.js';

import type {
  LedgerDeterministicCandidateClaim,
  LedgerDeterministicRecognizer,
  LedgerDeterministicRecognizerResult,
} from './deterministic-recognizer-runner.js';

export const LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY = 'reviewed_amount_time';

export const LedgerLinkingReviewedRelationshipOverrideSchema = z.object({
  acceptedAt: z.string().datetime(),
  assetIdentityReason: z.enum(['same_asset_id', 'accepted_assertion']),
  assetSymbol: z.string().min(1, 'Asset symbol must not be empty'),
  overrideEventId: z.string().min(1, 'Override event ID must not be empty'),
  proposalKind: z.literal('amount_time'),
  proposalUniqueness: z.enum(['unique_pair', 'ambiguous_source', 'ambiguous_target', 'ambiguous_both']),
  quantity: DecimalSchema.refine((quantity) => quantity.gt(0), 'Reviewed relationship quantity must be positive'),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  reviewId: z.string().min(1, 'Review ID must not be empty'),
  sourceActivityFingerprint: z.string().min(1, 'Source activity fingerprint must not be empty'),
  sourceAssetId: z.string().min(1, 'Source asset ID must not be empty'),
  sourceJournalFingerprint: z.string().min(1, 'Source journal fingerprint must not be empty'),
  sourcePostingFingerprint: z.string().min(1, 'Source posting fingerprint must not be empty'),
  targetActivityFingerprint: z.string().min(1, 'Target activity fingerprint must not be empty'),
  targetAssetId: z.string().min(1, 'Target asset ID must not be empty'),
  targetJournalFingerprint: z.string().min(1, 'Target journal fingerprint must not be empty'),
  targetPostingFingerprint: z.string().min(1, 'Target posting fingerprint must not be empty'),
  timeDirection: z.enum(['source_before_target', 'target_before_source', 'same_time']),
  timeDistanceSeconds: z.number().finite().nonnegative(),
});

export type LedgerLinkingReviewedRelationshipOverride = z.infer<typeof LedgerLinkingReviewedRelationshipOverrideSchema>;

export interface LedgerReviewedRelationshipOverrideMatch {
  overrideEventId: string;
  relationshipStableKey: string;
  reviewId: string;
  sourceCandidateId: number;
  targetCandidateId: number;
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
    name: LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY,
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
    const source = findReviewedCandidate(candidates, accepted, 'source');
    if (source.isErr()) {
      return err(source.error);
    }

    const target = findReviewedCandidate(candidates, accepted, 'target');
    if (target.isErr()) {
      return err(target.error);
    }

    const quantityValidation = validateReviewedRelationshipQuantity(accepted, source.value, target.value);
    if (quantityValidation.isErr()) {
      return err(quantityValidation.error);
    }

    const relationshipStableKey = buildReviewedLedgerLinkingRelationshipStableKey(accepted);
    if (relationshipStableKeys.has(relationshipStableKey)) {
      return err(new Error(`Duplicate reviewed ledger-linking relationship override ${relationshipStableKey}`));
    }
    relationshipStableKeys.add(relationshipStableKey);

    candidateClaims.push(
      { candidateId: source.value.candidateId, quantity: accepted.quantity },
      { candidateId: target.value.candidateId, quantity: accepted.quantity }
    );
    relationships.push(buildReviewedRelationshipDraft(accepted, relationshipStableKey));
    matches.push({
      overrideEventId: accepted.overrideEventId,
      relationshipStableKey,
      reviewId: accepted.reviewId,
      sourceCandidateId: source.value.candidateId,
      targetCandidateId: target.value.candidateId,
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
  return `ledger-linking:${LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY}:v1:${sha256Hex(
    [
      reviewedOverride.relationshipKind,
      reviewedOverride.proposalKind,
      reviewedOverride.sourceActivityFingerprint,
      reviewedOverride.sourceJournalFingerprint,
      reviewedOverride.sourcePostingFingerprint,
      reviewedOverride.targetActivityFingerprint,
      reviewedOverride.targetJournalFingerprint,
      reviewedOverride.targetPostingFingerprint,
      reviewedOverride.sourceAssetId,
      reviewedOverride.targetAssetId,
      reviewedOverride.quantity.toFixed(),
    ].join('\0')
  ).slice(0, 32)}`;
}

function findReviewedCandidate(
  candidates: readonly LedgerTransferLinkingCandidate[],
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  side: 'source' | 'target'
): Result<LedgerTransferLinkingCandidate, Error> {
  const expected = getReviewedCandidateIdentity(reviewedOverride, side);
  const candidate = candidates.find(
    (item) =>
      item.direction === side &&
      item.sourceActivityFingerprint === expected.sourceActivityFingerprint &&
      item.journalFingerprint === expected.journalFingerprint &&
      item.postingFingerprint === expected.postingFingerprint
  );

  if (candidate === undefined) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} no longer resolves ${side} posting ${expected.postingFingerprint}`
      )
    );
  }

  if (candidate.assetId !== expected.assetId) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} ${side} posting ${expected.postingFingerprint} asset changed from ${expected.assetId} to ${candidate.assetId}`
      )
    );
  }

  return ok(candidate);
}

function validateReviewedRelationshipQuantity(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  source: LedgerTransferLinkingCandidate,
  target: LedgerTransferLinkingCandidate
): Result<void, Error> {
  if (reviewedOverride.quantity.gt(source.amount)) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} overclaims source posting ${source.postingFingerprint}: ${reviewedOverride.quantity.toFixed()} of ${source.amount.toFixed()}`
      )
    );
  }

  if (reviewedOverride.quantity.gt(target.amount)) {
    return err(
      new Error(
        `Reviewed ledger-linking relationship ${reviewedOverride.reviewId} overclaims target posting ${target.postingFingerprint}: ${reviewedOverride.quantity.toFixed()} of ${target.amount.toFixed()}`
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
    allocations: [
      {
        allocationSide: 'source',
        journalFingerprint: reviewedOverride.sourceJournalFingerprint,
        postingFingerprint: reviewedOverride.sourcePostingFingerprint,
        quantity: reviewedOverride.quantity,
        sourceActivityFingerprint: reviewedOverride.sourceActivityFingerprint,
      },
      {
        allocationSide: 'target',
        journalFingerprint: reviewedOverride.targetJournalFingerprint,
        postingFingerprint: reviewedOverride.targetPostingFingerprint,
        quantity: reviewedOverride.quantity,
        sourceActivityFingerprint: reviewedOverride.targetActivityFingerprint,
      },
    ],
    confidenceScore: new Decimal(1),
    evidence: {
      acceptedAt: reviewedOverride.acceptedAt,
      amount: reviewedOverride.quantity.toFixed(),
      assetIdentityReason: reviewedOverride.assetIdentityReason,
      assetSymbol: reviewedOverride.assetSymbol,
      overrideEventId: reviewedOverride.overrideEventId,
      proposalKind: reviewedOverride.proposalKind,
      proposalUniqueness: reviewedOverride.proposalUniqueness,
      reviewId: reviewedOverride.reviewId,
      sourceAssetId: reviewedOverride.sourceAssetId,
      sourcePostingFingerprint: reviewedOverride.sourcePostingFingerprint,
      targetAssetId: reviewedOverride.targetAssetId,
      targetPostingFingerprint: reviewedOverride.targetPostingFingerprint,
      timeDirection: reviewedOverride.timeDirection,
      timeDistanceSeconds: reviewedOverride.timeDistanceSeconds,
    },
    recognitionStrategy: LEDGER_REVIEWED_AMOUNT_TIME_RELATIONSHIP_STRATEGY,
    relationshipKind: reviewedOverride.relationshipKind,
    relationshipStableKey,
  };
}

function getReviewedCandidateIdentity(
  reviewedOverride: LedgerLinkingReviewedRelationshipOverride,
  side: 'source' | 'target'
): {
  assetId: string;
  journalFingerprint: string;
  postingFingerprint: string;
  sourceActivityFingerprint: string;
} {
  if (side === 'source') {
    return {
      assetId: reviewedOverride.sourceAssetId,
      journalFingerprint: reviewedOverride.sourceJournalFingerprint,
      postingFingerprint: reviewedOverride.sourcePostingFingerprint,
      sourceActivityFingerprint: reviewedOverride.sourceActivityFingerprint,
    };
  }

  return {
    assetId: reviewedOverride.targetAssetId,
    journalFingerprint: reviewedOverride.targetJournalFingerprint,
    postingFingerprint: reviewedOverride.targetPostingFingerprint,
    sourceActivityFingerprint: reviewedOverride.targetActivityFingerprint,
  };
}
