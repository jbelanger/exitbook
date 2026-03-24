/**
 * Links view TUI state
 */

import type { LinkStatus } from '@exitbook/core';

import type { LinkGapAnalysis } from '../links-gap-model.js';
import type { LinkStatusCounts, LinkWithTransactions, TransferProposalWithTransactions } from '../links-view-model.js';
import { buildTransferProposalItems } from '../transfer-proposals.js';

interface LinksViewProposalFilters {
  maxConfidence?: number | undefined;
  minConfidence?: number | undefined;
}

/**
 * Links mode state
 */
export interface LinksViewLinksState {
  mode: 'links';

  // Data
  proposals: TransferProposalWithTransactions[];
  counts: LinkStatusCounts;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args)
  statusFilter?: LinkStatus | undefined;

  // Total count (before limiting)
  totalCount?: number | undefined;

  // Pending action (for optimistic updates)
  pendingAction?:
    | {
        action: 'confirm' | 'reject';
        affectedLinkIds: number[];
        linkId: number;
        proposalKey: string;
        transferProposalKey?: string | undefined;
      }
    | undefined;

  // Error display
  error?: string | undefined;

  // Verbose mode flag
  verbose: boolean;
}

/**
 * Gaps mode state
 */
export interface LinksViewGapsState {
  mode: 'gaps';

  linkAnalysis: LinkGapAnalysis;
  selectedIndex: number;
  scrollOffset: number;
}

/**
 * Discriminated union of links/gaps state
 */
export type LinksViewState = LinksViewLinksState | LinksViewGapsState;

/**
 * Create initial links view state
 */
export function createLinksViewState(
  links: LinkWithTransactions[],
  statusFilter?: LinkStatus,
  verbose = false,
  totalCount?: number,
  proposalFilters?: LinksViewProposalFilters
): LinksViewLinksState {
  const allProposals = buildTransferProposalItems(links)
    .map((proposal) => ({
      legs: proposal.items,
      proposalKey: proposal.proposalKey,
      representativeLeg: proposal.representativeItem,
      representativeLink: proposal.representativeLink,
      status: proposal.status,
      transferProposalKey: proposal.transferProposalKey,
    }))
    .sort((left, right) => {
      const leftTime = getProposalDisplayTime(left);
      const rightTime = getProposalDisplayTime(right);

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.representativeLink.id - right.representativeLink.id;
    });
  const proposals = allProposals.filter((proposal) => {
    if (statusFilter !== undefined && proposal.status !== statusFilter) {
      return false;
    }

    if (proposalFilters?.minConfidence === undefined && proposalFilters?.maxConfidence === undefined) {
      return true;
    }

    return proposal.legs.some((leg) => {
      const confidenceScore = leg.link.confidenceScore.toNumber();
      if (proposalFilters?.minConfidence !== undefined && confidenceScore < proposalFilters.minConfidence) {
        return false;
      }
      if (proposalFilters?.maxConfidence !== undefined && confidenceScore > proposalFilters.maxConfidence) {
        return false;
      }

      return true;
    });
  });

  // Calculate counts
  const counts = proposals.reduce(
    (acc, proposal) => {
      const status = proposal.status;
      if (status === 'confirmed') acc.confirmed += 1;
      else if (status === 'suggested') acc.suggested += 1;
      else if (status === 'rejected') acc.rejected += 1;
      return acc;
    },
    { confirmed: 0, suggested: 0, rejected: 0 }
  );

  return {
    mode: 'links',
    proposals,
    counts,
    selectedIndex: 0,
    scrollOffset: 0,
    statusFilter,
    totalCount: totalCount ?? allProposals.length,
    pendingAction: undefined,
    error: undefined,
    verbose,
  };
}

function getProposalDisplayTime(item: TransferProposalWithTransactions): number {
  const sourceTime = item.representativeLeg.sourceTransaction?.datetime
    ? Date.parse(item.representativeLeg.sourceTransaction.datetime)
    : Number.NaN;
  if (!Number.isNaN(sourceTime)) {
    return sourceTime;
  }

  const targetTime = item.representativeLeg.targetTransaction?.datetime
    ? Date.parse(item.representativeLeg.targetTransaction.datetime)
    : Number.NaN;
  if (!Number.isNaN(targetTime)) {
    return targetTime;
  }

  return item.representativeLink.createdAt.getTime();
}

/**
 * Create initial gaps view state
 */
export function createGapsViewState(analysis: LinkGapAnalysis): LinksViewGapsState {
  return {
    mode: 'gaps',
    linkAnalysis: analysis,
    selectedIndex: 0,
    scrollOffset: 0,
  };
}
