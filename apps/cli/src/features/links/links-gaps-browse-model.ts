import type { LinkGapIssue } from '@exitbook/accounting/linking';

import type { AddressOwnership } from '../shared/address-ownership.js';
import type { TransactionRelatedContext } from '../transactions/transactions-view-model.js';

export type LinkGapEndpointOwnership = AddressOwnership;

export interface LinkGapBrowseTransactionSnapshot {
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
  relatedContext?: TransactionRelatedContext | undefined;
  suggestedProposalRefs?: string[] | undefined;
  transactionSnapshot?: LinkGapBrowseTransactionSnapshot | undefined;
  transactionGapCount: number;
  transactionRef: string;
}

export interface LinksGapBrowseHiddenCounts {
  hiddenResolvedIssueCount: number;
}
