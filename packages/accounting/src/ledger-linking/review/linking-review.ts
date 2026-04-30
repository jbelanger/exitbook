import { sha256Hex } from '@exitbook/foundation';
import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';

import type { LedgerLinkingAssetIdentitySuggestion } from '../asset-identity/asset-identity-suggestions.js';
import type {
  LedgerLinkingAmountTimeProposal,
  LedgerLinkingAmountTimeProposalUniqueness,
  LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';

const REVIEW_ID_HASH_LENGTH = 12;

export type LedgerLinkingReviewItemKind = 'asset_identity_suggestion' | 'link_proposal';
export type LedgerLinkingReviewEvidenceStrength = 'strong' | 'medium' | 'weak';
export type LedgerLinkingReviewLinkProposalKind = 'amount_time';

export interface LedgerLinkingReviewQueueBuildInput {
  assetIdentitySuggestions: readonly LedgerLinkingAssetIdentitySuggestion[];
  diagnostics?: LedgerLinkingDiagnostics | undefined;
}

export interface LedgerLinkingReviewQueue {
  assetIdentitySuggestionCount: number;
  itemCount: number;
  items: readonly LedgerLinkingReviewItem[];
  linkProposalCount: number;
}

export type LedgerLinkingReviewItem =
  | LedgerLinkingReviewAssetIdentitySuggestionItem
  | LedgerLinkingReviewLinkProposalItem;

export interface LedgerLinkingReviewAssetIdentitySuggestionItem {
  evidenceStrength: LedgerLinkingReviewEvidenceStrength;
  kind: 'asset_identity_suggestion';
  reviewId: string;
  suggestion: LedgerLinkingAssetIdentitySuggestion;
}

export interface LedgerLinkingReviewLinkProposalItem {
  evidenceStrength: LedgerLinkingReviewEvidenceStrength;
  kind: 'link_proposal';
  proposal: LedgerLinkingAmountTimeProposal;
  proposalKind: LedgerLinkingReviewLinkProposalKind;
  relationshipKind: AccountingJournalRelationshipKind;
  reviewId: string;
}

export function buildLedgerLinkingReviewQueue(input: LedgerLinkingReviewQueueBuildInput): LedgerLinkingReviewQueue {
  const assetIdentityItems = input.assetIdentitySuggestions.map(toAssetIdentityReviewItem);
  const linkProposalItems = (input.diagnostics?.amountTimeProposals ?? [])
    .filter(hasActionableInternalTransferTiming)
    .map(toAmountTimeLinkProposalReviewItem);
  const items = [...assetIdentityItems, ...linkProposalItems].sort(compareReviewItems);

  return {
    assetIdentitySuggestionCount: assetIdentityItems.length,
    itemCount: items.length,
    items,
    linkProposalCount: linkProposalItems.length,
  };
}

function hasActionableInternalTransferTiming(proposal: LedgerLinkingAmountTimeProposal): boolean {
  return proposal.timeDirection !== 'target_before_source';
}

function toAssetIdentityReviewItem(
  suggestion: LedgerLinkingAssetIdentitySuggestion
): LedgerLinkingReviewAssetIdentitySuggestionItem {
  return {
    evidenceStrength: resolveAssetIdentityEvidenceStrength(suggestion),
    kind: 'asset_identity_suggestion',
    reviewId: buildReviewId('ai', [
      'asset_identity_suggestion',
      'v1',
      suggestion.relationshipKind,
      suggestion.evidenceKind,
      suggestion.assetIdA,
      suggestion.assetIdB,
      suggestion.assetSymbol,
    ]),
    suggestion,
  };
}

function toAmountTimeLinkProposalReviewItem(
  proposal: LedgerLinkingAmountTimeProposal
): LedgerLinkingReviewLinkProposalItem {
  return {
    evidenceStrength: resolveAmountTimeProposalEvidenceStrength(proposal.uniqueness),
    kind: 'link_proposal',
    proposal,
    proposalKind: 'amount_time',
    relationshipKind: 'internal_transfer',
    reviewId: buildReviewId('lp', [
      'link_proposal',
      'amount_time',
      'v1',
      'internal_transfer',
      proposal.source.postingFingerprint,
      proposal.target.postingFingerprint,
      proposal.amount,
      proposal.source.assetId,
      proposal.target.assetId,
    ]),
  };
}

function resolveAssetIdentityEvidenceStrength(
  suggestion: LedgerLinkingAssetIdentitySuggestion
): LedgerLinkingReviewEvidenceStrength {
  switch (suggestion.evidenceKind) {
    case 'exact_hash_observed':
      return 'strong';
    case 'amount_time_observed':
      return 'medium';
  }
}

function resolveAmountTimeProposalEvidenceStrength(
  uniqueness: LedgerLinkingAmountTimeProposalUniqueness
): LedgerLinkingReviewEvidenceStrength {
  return uniqueness === 'unique_pair' ? 'medium' : 'weak';
}

function buildReviewId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${sha256Hex(parts.join('\0')).slice(0, REVIEW_ID_HASH_LENGTH)}`;
}

function compareReviewItems(left: LedgerLinkingReviewItem, right: LedgerLinkingReviewItem): number {
  return (
    reviewItemKindRank(left.kind) - reviewItemKindRank(right.kind) ||
    compareEvidenceStrength(left.evidenceStrength, right.evidenceStrength) ||
    compareReviewItemDetails(left, right) ||
    left.reviewId.localeCompare(right.reviewId)
  );
}

function reviewItemKindRank(kind: LedgerLinkingReviewItemKind): number {
  switch (kind) {
    case 'asset_identity_suggestion':
      return 0;
    case 'link_proposal':
      return 1;
  }
}

function compareEvidenceStrength(
  left: LedgerLinkingReviewEvidenceStrength,
  right: LedgerLinkingReviewEvidenceStrength
): number {
  return evidenceStrengthRank(left) - evidenceStrengthRank(right);
}

function evidenceStrengthRank(strength: LedgerLinkingReviewEvidenceStrength): number {
  switch (strength) {
    case 'strong':
      return 0;
    case 'medium':
      return 1;
    case 'weak':
      return 2;
  }
}

function compareReviewItemDetails(left: LedgerLinkingReviewItem, right: LedgerLinkingReviewItem): number {
  if (left.kind === 'asset_identity_suggestion' && right.kind === 'asset_identity_suggestion') {
    return compareAssetIdentitySuggestionItems(left, right);
  }

  if (left.kind === 'link_proposal' && right.kind === 'link_proposal') {
    return compareLinkProposalItems(left, right);
  }

  return 0;
}

function compareAssetIdentitySuggestionItems(
  left: LedgerLinkingReviewAssetIdentitySuggestionItem,
  right: LedgerLinkingReviewAssetIdentitySuggestionItem
): number {
  return (
    left.suggestion.assetSymbol.localeCompare(right.suggestion.assetSymbol) ||
    right.suggestion.blockCount - left.suggestion.blockCount ||
    left.suggestion.relationshipKind.localeCompare(right.suggestion.relationshipKind) ||
    left.suggestion.assetIdA.localeCompare(right.suggestion.assetIdA) ||
    left.suggestion.assetIdB.localeCompare(right.suggestion.assetIdB)
  );
}

function compareLinkProposalItems(
  left: LedgerLinkingReviewLinkProposalItem,
  right: LedgerLinkingReviewLinkProposalItem
): number {
  return (
    compareLinkProposalUniqueness(left.proposal.uniqueness, right.proposal.uniqueness) ||
    left.proposal.timeDistanceSeconds - right.proposal.timeDistanceSeconds ||
    left.proposal.assetSymbol.localeCompare(right.proposal.assetSymbol) ||
    left.proposal.amount.localeCompare(right.proposal.amount) ||
    left.proposal.source.platformKey.localeCompare(right.proposal.source.platformKey) ||
    left.proposal.target.platformKey.localeCompare(right.proposal.target.platformKey) ||
    left.proposal.source.candidateId - right.proposal.source.candidateId ||
    left.proposal.target.candidateId - right.proposal.target.candidateId
  );
}

function compareLinkProposalUniqueness(
  left: LedgerLinkingAmountTimeProposalUniqueness,
  right: LedgerLinkingAmountTimeProposalUniqueness
): number {
  return linkProposalUniquenessRank(left) - linkProposalUniquenessRank(right);
}

function linkProposalUniquenessRank(uniqueness: LedgerLinkingAmountTimeProposalUniqueness): number {
  switch (uniqueness) {
    case 'unique_pair':
      return 0;
    case 'ambiguous_source':
      return 1;
    case 'ambiguous_target':
      return 2;
    case 'ambiguous_both':
      return 3;
  }
}
