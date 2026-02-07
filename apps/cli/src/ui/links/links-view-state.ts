/**
 * Links view TUI state
 */

import type { LinkStatus, TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';

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
 * Links view state
 */
export interface LinksViewState {
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
  pendingAction?: { action: 'confirm' | 'reject'; linkId: string; } | undefined;

  // Error display
  error?: string | undefined;

  // Verbose mode flag
  verbose: boolean;
}

/**
 * Create initial links view state
 */
export function createLinksViewState(
  links: LinkWithTransactions[],
  statusFilter?: LinkStatus,
  verbose = false,
  totalCount?: number
): LinksViewState {
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
