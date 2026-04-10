import type { LinkGapIssue } from './links-gap-model.js';

export interface LinkGapBrowseItem {
  gapIssue: LinkGapIssue;
  transactionGapCount: number;
  transactionRef: string;
}

export interface LinksGapBrowseHiddenCounts {
  hiddenResolvedIssueCount: number;
  hiddenResolvedTransactionCount: number;
}
