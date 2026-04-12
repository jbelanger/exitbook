import type { CostBasisJurisdiction } from '../jurisdictions/jurisdiction-configs.js';

export function formatUnresolvedAssetReviewIssueSummary(): string {
  return 'Assets still require review before filing export.';
}

export function formatUnresolvedAssetReviewNotice(count: number): string {
  return `${count} ${count === 1 ? 'asset still requires' : 'assets still require'} review before filing export.`;
}

export function formatUnresolvedAssetReviewIssueDetails(params: {
  count: number;
  jurisdiction: CostBasisJurisdiction;
  taxYear: number;
}): string {
  return `Tax package export for ${params.jurisdiction} ${params.taxYear} is blocked because ${formatUnresolvedAssetReviewNotice(params.count).toLowerCase()}`;
}

export function formatIncompleteTransferLinkingIssueSummary(): string {
  return 'Some transfers were not fully linked.';
}

export function formatIncompleteTransferLinkingNotice(count: number): string {
  return `${count} ${count === 1 ? 'transfer requires' : 'transfers require'} manual review because a confirmed source/target link is missing.`;
}
