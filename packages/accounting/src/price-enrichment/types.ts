import type { UniversalTransaction } from '@exitbook/core';

import type { TransactionLink } from '../linking/types.js';

/**
 * A group of transitively linked transactions
 * Built using Union-Find algorithm to group all connected transactions together
 */
export interface TransactionGroup {
  /**
   * Unique identifier for this group
   */
  groupId: string;

  /**
   * All transactions in this group (may span multiple exchanges/blockchains)
   */
  transactions: UniversalTransaction[];

  /**
   * Set of unique source IDs in this group
   * e.g., ['kraken', 'bitcoin', 'ethereum']
   */
  sources: Set<string>;

  /**
   * All confirmed links within this group
   */
  linkChain: TransactionLink[];
}
