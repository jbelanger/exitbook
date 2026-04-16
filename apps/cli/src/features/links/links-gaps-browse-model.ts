import type { LinkGapIssue } from '@exitbook/accounting/linking';

export type LinkGapEndpointOwnership = 'tracked' | 'untracked';

export interface LinkGapBrowseTransactionContext {
  blockchainTransactionHash?: string | undefined;
  from?: string | undefined;
  fromOwnership?: LinkGapEndpointOwnership | undefined;
  openSameHashGapRowCount?: number | undefined;
  openSameHashTransactionRefs?: string[] | undefined;
  to?: string | undefined;
  toOwnership?: LinkGapEndpointOwnership | undefined;
}

export interface LinkGapBrowseItem {
  gapRef: string;
  gapIssue: LinkGapIssue;
  suggestedProposalRefs?: string[] | undefined;
  transactionContext?: LinkGapBrowseTransactionContext | undefined;
  transactionGapCount: number;
  transactionRef: string;
}

export interface LinksGapBrowseHiddenCounts {
  hiddenResolvedIssueCount: number;
}
