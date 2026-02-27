/**
 * Links view TUI state
 */

import type { LinkStatus, TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';

import type { LinkGapAnalysis } from '../links-gap-utils.js';

/**
 * Link with associated transaction data for display
 */
export interface LinkWithTransactions {
  link: TransactionLink;
  sourceTransaction: UniversalTransactionData | undefined;
  targetTransaction: UniversalTransactionData | undefined;
}

/**
 * Status counts for header
 */
export interface LinkStatusCounts {
  confirmed: number;
  suggested: number;
  rejected: number;
}

/**
 * Links mode state
 */
export interface LinksViewLinksState {
  mode: 'links';

  // Data
  links: LinkWithTransactions[];
  counts: LinkStatusCounts;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters (applied from CLI args)
  statusFilter?: LinkStatus | undefined;

  // Total count (before limiting)
  totalCount?: number | undefined;

  // Pending action (for optimistic updates)
  pendingAction?: { action: 'confirm' | 'reject'; linkId: number } | undefined;

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
  totalCount?: number
): LinksViewLinksState {
  // Calculate counts
  const counts = links.reduce(
    (acc, item) => {
      const status = item.link.status;
      if (status === 'confirmed') acc.confirmed += 1;
      else if (status === 'suggested') acc.suggested += 1;
      else if (status === 'rejected') acc.rejected += 1;
      return acc;
    },
    { confirmed: 0, suggested: 0, rejected: 0 }
  );

  return {
    mode: 'links',
    links,
    counts,
    selectedIndex: 0,
    scrollOffset: 0,
    statusFilter,
    totalCount,
    pendingAction: undefined,
    error: undefined,
    verbose,
  };
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
