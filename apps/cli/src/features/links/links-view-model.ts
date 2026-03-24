import type { LinkStatus, Transaction, TransactionLink } from '@exitbook/core';

/**
 * Link with associated transaction data for display
 */
export interface LinkWithTransactions {
  link: TransactionLink;
  sourceTransaction: Transaction | undefined;
  targetTransaction: Transaction | undefined;
}

export interface TransferProposalWithTransactions {
  legs: LinkWithTransactions[];
  proposalKey: string;
  representativeLeg: LinkWithTransactions;
  representativeLink: TransactionLink;
  status: LinkStatus;
  transferProposalKey?: string | undefined;
}

/**
 * Status counts for header
 */
export interface LinkStatusCounts {
  confirmed: number;
  suggested: number;
  rejected: number;
}
