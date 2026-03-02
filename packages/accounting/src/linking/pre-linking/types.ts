export type { LinkableMovement, NewLinkableMovement } from '@exitbook/core';

import type { NewLinkableMovement } from '@exitbook/core';

import type { NewTransactionLink } from '../types.js';

/**
 * Result of the materialization phase.
 */
export interface MaterializationResult {
  /** Linkable movements to persist and pass to strategies */
  movements: NewLinkableMovement[];
  /** Internal blockchain links (same tx hash, different tracked addresses) — always confirmed */
  internalLinks: NewTransactionLink[];
}
