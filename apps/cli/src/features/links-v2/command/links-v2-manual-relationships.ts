import type { LedgerTransferLinkingCandidate } from '@exitbook/accounting/ledger-linking';
import type { LedgerLinkingRelationshipAcceptPayload } from '@exitbook/core';
import { err, ok, sha256Hex, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

const MANUAL_RELATIONSHIP_PROPOSAL_KIND = 'manual_relationship';

export type LinksV2ManualRelationshipKind =
  | 'internal_transfer'
  | 'external_transfer'
  | 'same_hash_carryover'
  | 'bridge'
  | 'asset_migration';

export interface BuildLinksV2ManualRelationshipAcceptPayloadParams {
  candidates: readonly LedgerTransferLinkingCandidate[];
  reason: string;
  relationshipKind: LinksV2ManualRelationshipKind;
  sourcePostingFingerprint: string;
  sourceQuantity?: string | undefined;
  targetPostingFingerprint: string;
  targetQuantity?: string | undefined;
}

export function buildLinksV2ManualRelationshipAcceptPayload(
  params: BuildLinksV2ManualRelationshipAcceptPayloadParams
): Result<LedgerLinkingRelationshipAcceptPayload, Error> {
  const source = resolveManualRelationshipCandidate(params.candidates, 'source', params.sourcePostingFingerprint);
  if (source.isErr()) {
    return err(source.error);
  }

  const target = resolveManualRelationshipCandidate(params.candidates, 'target', params.targetPostingFingerprint);
  if (target.isErr()) {
    return err(target.error);
  }

  if (source.value.postingFingerprint === target.value.postingFingerprint) {
    return err(new Error('Manual links-v2 relationship source and target postings must be different'));
  }

  const sourceQuantity = resolveManualRelationshipQuantity(params.sourceQuantity, source.value, 'source');
  if (sourceQuantity.isErr()) {
    return err(sourceQuantity.error);
  }

  const targetQuantity = resolveManualRelationshipQuantity(params.targetQuantity, target.value, 'target');
  if (targetQuantity.isErr()) {
    return err(targetQuantity.error);
  }

  return ok(
    toManualRelationshipAcceptPayload({
      reason: params.reason,
      relationshipKind: params.relationshipKind,
      source: source.value,
      sourceQuantity: sourceQuantity.value,
      target: target.value,
      targetQuantity: targetQuantity.value,
    })
  );
}

function resolveManualRelationshipCandidate(
  candidates: readonly LedgerTransferLinkingCandidate[],
  side: 'source' | 'target',
  postingFingerprint: string
): Result<LedgerTransferLinkingCandidate, Error> {
  const samePostingCandidates = candidates.filter((candidate) => candidate.postingFingerprint === postingFingerprint);
  const matchingSideCandidates = samePostingCandidates.filter((candidate) => candidate.direction === side);

  if (matchingSideCandidates.length === 1) {
    const candidate = matchingSideCandidates[0];
    if (candidate === undefined) {
      return err(new Error(`Manual links-v2 relationship ${side} posting ${postingFingerprint} did not resolve`));
    }

    return ok(candidate);
  }

  if (matchingSideCandidates.length > 1) {
    return err(
      new Error(`Manual links-v2 relationship ${side} posting ${postingFingerprint} matched multiple candidates`)
    );
  }

  const wrongSideCandidate = samePostingCandidates[0];
  if (wrongSideCandidate !== undefined) {
    return err(
      new Error(
        `Manual links-v2 relationship expected ${postingFingerprint} to be a ${side} posting, but it is a ${wrongSideCandidate.direction} posting`
      )
    );
  }

  return err(new Error(`Manual links-v2 relationship ${side} posting ${postingFingerprint} is not linkable`));
}

function resolveManualRelationshipQuantity(
  rawQuantity: string | undefined,
  candidate: LedgerTransferLinkingCandidate,
  side: 'source' | 'target'
): Result<Decimal, Error> {
  const quantityResult =
    rawQuantity === undefined ? ok(candidate.amount) : parseManualRelationshipQuantity(rawQuantity);
  if (quantityResult.isErr()) {
    return err(new Error(`Invalid manual links-v2 relationship ${side} quantity: ${quantityResult.error.message}`));
  }

  const quantity = quantityResult.value;
  if (quantity.gt(candidate.amount)) {
    return err(
      new Error(
        `Manual links-v2 relationship ${side} quantity ${quantity.toFixed()} overclaims posting ${candidate.postingFingerprint}: available ${candidate.amount.toFixed()}`
      )
    );
  }

  return ok(quantity);
}

function parseManualRelationshipQuantity(rawQuantity: string): Result<Decimal, Error> {
  try {
    const quantity = new Decimal(rawQuantity);
    if (!quantity.isFinite() || !quantity.gt(0)) {
      return err(new Error('quantity must be a positive decimal'));
    }

    return ok(quantity);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function toManualRelationshipAcceptPayload(input: {
  reason: string;
  relationshipKind: LinksV2ManualRelationshipKind;
  source: LedgerTransferLinkingCandidate;
  sourceQuantity: Decimal;
  target: LedgerTransferLinkingCandidate;
  targetQuantity: Decimal;
}): LedgerLinkingRelationshipAcceptPayload {
  return {
    allocations: [
      {
        allocation_side: 'source',
        asset_id: input.source.assetId,
        asset_symbol: input.source.assetSymbol,
        journal_fingerprint: input.source.journalFingerprint,
        posting_fingerprint: input.source.postingFingerprint,
        quantity: input.sourceQuantity.toFixed(),
        source_activity_fingerprint: input.source.sourceActivityFingerprint,
      },
      {
        allocation_side: 'target',
        asset_id: input.target.assetId,
        asset_symbol: input.target.assetSymbol,
        journal_fingerprint: input.target.journalFingerprint,
        posting_fingerprint: input.target.postingFingerprint,
        quantity: input.targetQuantity.toFixed(),
        source_activity_fingerprint: input.target.sourceActivityFingerprint,
      },
    ],
    evidence: {
      reason: input.reason,
      sourceActivityDatetime: input.source.activityDatetime.toISOString(),
      sourceCandidateId: input.source.candidateId,
      sourcePlatformKey: input.source.platformKey,
      sourceQuantity: input.sourceQuantity.toFixed(),
      targetActivityDatetime: input.target.activityDatetime.toISOString(),
      targetCandidateId: input.target.candidateId,
      targetPlatformKey: input.target.platformKey,
      targetQuantity: input.targetQuantity.toFixed(),
    },
    proposal_kind: MANUAL_RELATIONSHIP_PROPOSAL_KIND,
    relationship_kind: input.relationshipKind,
    review_id: buildManualRelationshipReviewId(input),
    type: 'ledger_linking_relationship_accept',
  };
}

function buildManualRelationshipReviewId(input: {
  relationshipKind: LinksV2ManualRelationshipKind;
  source: LedgerTransferLinkingCandidate;
  sourceQuantity: Decimal;
  target: LedgerTransferLinkingCandidate;
  targetQuantity: Decimal;
}): string {
  return `manual_${sha256Hex(
    [
      input.relationshipKind,
      input.source.sourceActivityFingerprint,
      input.source.journalFingerprint,
      input.source.postingFingerprint,
      input.sourceQuantity.toFixed(),
      input.target.sourceActivityFingerprint,
      input.target.journalFingerprint,
      input.target.postingFingerprint,
      input.targetQuantity.toFixed(),
    ].join('\0')
  ).slice(0, 12)}`;
}
