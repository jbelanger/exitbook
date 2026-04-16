import type { LinkGapIssue } from '@exitbook/accounting/linking';

import type { AddressOwnership } from '../shared/address-ownership.js';

export type LinkGapEndpointOwnership = AddressOwnership;

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
