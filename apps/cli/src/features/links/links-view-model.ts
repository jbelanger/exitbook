import type {
  LinkStatus,
  OverrideLinkType,
  Transaction,
  TransactionLink,
  TransactionLinkProvenance,
} from '@exitbook/core';

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
  provenanceSummary: LinkProposalProvenanceSummary;
  proposalKey: string;
  representativeLeg: LinkWithTransactions;
  representativeLink: TransactionLink;
  status: LinkStatus;
  transferProposalKey?: string | undefined;
}

export interface LinkProposalProvenanceSummary {
  provenance: TransactionLinkProvenance | 'mixed';
  overrideIds: string[];
  overrideLinkTypes: OverrideLinkType[];
  manualLegCount: number;
  systemLegCount: number;
  userLegCount: number;
}

/**
 * Status counts for header
 */
export interface LinkStatusCounts {
  confirmed: number;
  suggested: number;
  rejected: number;
}
