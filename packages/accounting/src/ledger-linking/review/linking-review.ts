import { sha256Hex } from '@exitbook/foundation';
import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';

import type { LedgerLinkingAssetIdentitySuggestion } from '../asset-identity/asset-identity-suggestions.js';
import type {
  LedgerLinkingAmountTimeProposal,
  LedgerLinkingAmountTimeProposalUniqueness,
  LedgerLinkingAssetMigrationProposal,
  LedgerLinkingCandidateRemainder,
  LedgerLinkingDiagnostics,
} from '../diagnostics/linking-diagnostics.js';
import {
  buildLedgerLinkingGapResolutionSuggestions,
  type LedgerLinkingGapResolutionSuggestion,
} from '../gaps/ledger-linking-gap-resolutions.js';

const REVIEW_ID_HASH_LENGTH = 12;

export type LedgerLinkingReviewItemKind = 'asset_identity_suggestion' | 'link_proposal' | 'gap_resolution';
export type LedgerLinkingReviewEvidenceStrength = 'strong' | 'medium' | 'weak';
export type LedgerLinkingReviewLinkProposalKind =
  | 'amount_time'
  | 'asset_migration_same_hash'
  | 'bridge_amount_time'
  | 'processor_asset_migration';

export interface LedgerLinkingReviewQueueBuildInput {
  assetIdentitySuggestions: readonly LedgerLinkingAssetIdentitySuggestion[];
  diagnostics?: LedgerLinkingDiagnostics | undefined;
  resolvedGapResolutionKeys?: ReadonlySet<string> | undefined;
}

export interface LedgerLinkingReviewQueue {
  assetIdentitySuggestionCount: number;
  gapResolutionCount: number;
  itemCount: number;
  items: readonly LedgerLinkingReviewItem[];
  linkProposalCount: number;
}

export type LedgerLinkingReviewItem =
  | LedgerLinkingReviewAssetIdentitySuggestionItem
  | LedgerLinkingReviewGapResolutionItem
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
  proposal: LedgerLinkingReviewRelationshipProposal;
  proposalKind: LedgerLinkingReviewLinkProposalKind;
  relationshipKind: AccountingJournalRelationshipKind;
  reviewId: string;
}

export type LedgerLinkingReviewRelationshipProposal =
  | LedgerLinkingAmountTimeProposal
  | LedgerLinkingAssetMigrationProposal;

export interface LedgerLinkingReviewGapResolutionItem {
  evidenceStrength: LedgerLinkingReviewEvidenceStrength;
  kind: 'gap_resolution';
  resolution: LedgerLinkingGapResolutionSuggestion;
  reviewId: string;
}

export function buildLedgerLinkingReviewQueue(input: LedgerLinkingReviewQueueBuildInput): LedgerLinkingReviewQueue {
  const assetIdentityItems = input.assetIdentitySuggestions.map(toAssetIdentityReviewItem);
  const amountTimeLinkProposalItems = (input.diagnostics?.amountTimeProposals ?? [])
    .filter(hasActionableTiming)
    .map(toAmountTimeLinkProposalReviewItem);
  const assetMigrationLinkProposalItems = (input.diagnostics?.assetMigrationProposals ?? []).map(
    toAssetMigrationLinkProposalReviewItem
  );
  const linkProposalItems = [...amountTimeLinkProposalItems, ...assetMigrationLinkProposalItems];
  const gapResolutionItems =
    input.diagnostics === undefined
      ? []
      : buildLedgerLinkingGapResolutionSuggestions(input.diagnostics, {
          resolvedGapResolutionKeys: input.resolvedGapResolutionKeys,
        }).map(toGapResolutionReviewItem);
  const items = [...assetIdentityItems, ...linkProposalItems, ...gapResolutionItems].sort(compareReviewItems);

  return {
    assetIdentitySuggestionCount: assetIdentityItems.length,
    gapResolutionCount: gapResolutionItems.length,
    itemCount: items.length,
    items,
    linkProposalCount: linkProposalItems.length,
  };
}

function hasActionableTiming(proposal: LedgerLinkingAmountTimeProposal): boolean {
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
  const relationshipKind = resolveAmountTimeProposalRelationshipKind(proposal);
  const proposalKind = relationshipKind === 'bridge' ? 'bridge_amount_time' : 'amount_time';

  return {
    evidenceStrength: resolveAmountTimeProposalEvidenceStrength(proposal.uniqueness),
    kind: 'link_proposal',
    proposal,
    proposalKind,
    relationshipKind,
    reviewId: buildReviewId('lp', [
      'link_proposal',
      proposalKind,
      'v1',
      relationshipKind,
      proposal.source.postingFingerprint,
      proposal.target.postingFingerprint,
      proposal.amount,
      proposal.source.assetId,
      proposal.target.assetId,
    ]),
  };
}

function toAssetMigrationLinkProposalReviewItem(
  proposal: LedgerLinkingAssetMigrationProposal
): LedgerLinkingReviewLinkProposalItem {
  const proposalKind = resolveAssetMigrationProposalKind(proposal);

  return {
    evidenceStrength: resolveAssetMigrationProposalEvidenceStrength(proposal),
    kind: 'link_proposal',
    proposal,
    proposalKind,
    relationshipKind: 'asset_migration',
    reviewId: buildReviewId('lp', [
      'link_proposal',
      proposalKind,
      'v1',
      'asset_migration',
      proposal.source.postingFingerprint,
      proposal.target.postingFingerprint,
      proposal.sourceQuantity,
      proposal.targetQuantity,
      proposal.source.assetId,
      proposal.target.assetId,
    ]),
  };
}

function resolveAmountTimeProposalRelationshipKind(
  proposal: LedgerLinkingAmountTimeProposal
): AccountingJournalRelationshipKind {
  if (isBridgeAmountTimeProposal(proposal)) {
    return 'bridge';
  }

  return 'internal_transfer';
}

function resolveAssetMigrationProposalKind(
  proposal: LedgerLinkingAssetMigrationProposal
): LedgerLinkingReviewLinkProposalKind {
  switch (proposal.evidence) {
    case 'same_hash_symbol_migration':
      return 'asset_migration_same_hash';
    case 'processor_context_approximate_amount':
      return 'processor_asset_migration';
  }
}

function isBridgeAmountTimeProposal(proposal: LedgerLinkingAmountTimeProposal): boolean {
  return (
    proposal.source.platformKind === 'blockchain' &&
    proposal.target.platformKind === 'blockchain' &&
    proposal.source.platformKey !== proposal.target.platformKey &&
    hasJournalDiagnosticCode(proposal.source, 'bridge_transfer') &&
    hasJournalDiagnosticCode(proposal.target, 'bridge_transfer')
  );
}

function hasJournalDiagnosticCode(candidate: LedgerLinkingCandidateRemainder, diagnosticCode: string): boolean {
  return (candidate.journalDiagnosticCodes ?? []).includes(diagnosticCode);
}

function toGapResolutionReviewItem(
  resolution: LedgerLinkingGapResolutionSuggestion
): LedgerLinkingReviewGapResolutionItem {
  return {
    evidenceStrength: resolveGapResolutionEvidenceStrength(resolution),
    kind: 'gap_resolution',
    resolution,
    reviewId: buildReviewId('gr', [
      'gap_resolution',
      'v1',
      resolution.resolutionKind,
      resolution.candidate.postingFingerprint,
      resolution.candidate.remainingAmount,
      resolution.candidate.assetId,
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

function resolveGapResolutionEvidenceStrength(
  resolution: LedgerLinkingGapResolutionSuggestion
): LedgerLinkingReviewEvidenceStrength {
  switch (resolution.resolutionKind) {
    case 'accepted_transfer_residual':
    case 'fiat_cash_movement':
    case 'likely_spam_airdrop':
      return 'strong';
    case 'likely_dust_airdrop':
      return 'medium';
  }
}

function resolveAmountTimeProposalEvidenceStrength(
  uniqueness: LedgerLinkingAmountTimeProposalUniqueness
): LedgerLinkingReviewEvidenceStrength {
  return uniqueness === 'unique_pair' ? 'medium' : 'weak';
}

function resolveAssetMigrationProposalEvidenceStrength(
  proposal: LedgerLinkingAssetMigrationProposal
): LedgerLinkingReviewEvidenceStrength {
  if (proposal.evidence === 'same_hash_symbol_migration' && proposal.uniqueness === 'unique_pair') {
    return 'strong';
  }

  return proposal.uniqueness === 'unique_pair' ? 'medium' : 'weak';
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
    case 'gap_resolution':
      return 2;
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

  if (left.kind === 'gap_resolution' && right.kind === 'gap_resolution') {
    return compareGapResolutionItems(left, right);
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
    linkProposalKindRank(left.proposalKind) - linkProposalKindRank(right.proposalKind) ||
    left.proposal.timeDistanceSeconds - right.proposal.timeDistanceSeconds ||
    getProposalSourceAssetSymbol(left.proposal).localeCompare(getProposalSourceAssetSymbol(right.proposal)) ||
    getProposalTargetAssetSymbol(left.proposal).localeCompare(getProposalTargetAssetSymbol(right.proposal)) ||
    getProposalSourceQuantity(left.proposal).localeCompare(getProposalSourceQuantity(right.proposal)) ||
    getProposalTargetQuantity(left.proposal).localeCompare(getProposalTargetQuantity(right.proposal)) ||
    left.proposal.source.platformKey.localeCompare(right.proposal.source.platformKey) ||
    left.proposal.target.platformKey.localeCompare(right.proposal.target.platformKey) ||
    left.proposal.source.candidateId - right.proposal.source.candidateId ||
    left.proposal.target.candidateId - right.proposal.target.candidateId
  );
}

function linkProposalKindRank(kind: LedgerLinkingReviewLinkProposalKind): number {
  switch (kind) {
    case 'asset_migration_same_hash':
      return 0;
    case 'processor_asset_migration':
      return 1;
    case 'bridge_amount_time':
      return 2;
    case 'amount_time':
      return 3;
  }
}

function getProposalSourceAssetSymbol(proposal: LedgerLinkingReviewRelationshipProposal): string {
  return proposal.source.assetSymbol;
}

function getProposalTargetAssetSymbol(proposal: LedgerLinkingReviewRelationshipProposal): string {
  return proposal.target.assetSymbol;
}

function getProposalSourceQuantity(proposal: LedgerLinkingReviewRelationshipProposal): string {
  return proposal.sourceQuantity;
}

function getProposalTargetQuantity(proposal: LedgerLinkingReviewRelationshipProposal): string {
  return proposal.targetQuantity;
}

function compareGapResolutionItems(
  left: LedgerLinkingReviewGapResolutionItem,
  right: LedgerLinkingReviewGapResolutionItem
): number {
  return (
    gapResolutionKindRank(left.resolution.resolutionKind) - gapResolutionKindRank(right.resolution.resolutionKind) ||
    left.resolution.candidate.assetSymbol.localeCompare(right.resolution.candidate.assetSymbol) ||
    left.resolution.candidate.platformKey.localeCompare(right.resolution.candidate.platformKey) ||
    left.resolution.candidate.activityDatetime.getTime() - right.resolution.candidate.activityDatetime.getTime() ||
    left.resolution.candidate.postingFingerprint.localeCompare(right.resolution.candidate.postingFingerprint)
  );
}

function gapResolutionKindRank(kind: LedgerLinkingGapResolutionSuggestion['resolutionKind']): number {
  switch (kind) {
    case 'accepted_transfer_residual':
      return 0;
    case 'fiat_cash_movement':
      return 1;
    case 'likely_spam_airdrop':
      return 2;
    case 'likely_dust_airdrop':
      return 3;
  }
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
