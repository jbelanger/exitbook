import type { LinkGapIssue } from '@exitbook/accounting/linking';

export interface LinkGapBrowseItem {
  gapIssue: LinkGapIssue;
  transactionGapCount: number;
  transactionRef: string;
}

export interface LinksGapBrowseHiddenCounts {
  hiddenResolvedIssueCount: number;
  hiddenResolvedTransactionCount: number;
}
