import type { LinkGapIssue } from './links-gap-model.js';
import type { TransferProposalWithTransactions } from './links-view-model.js';

export interface LinkProposalBrowseItem {
  proposal: TransferProposalWithTransactions;
  proposalRef: string;
}

export interface LinkGapBrowseItem {
  issue: LinkGapIssue;
  transactionRef: string;
}
