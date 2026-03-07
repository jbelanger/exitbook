import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

import type { LinkableMovement, NewLinkableMovement } from '../linking/pre-linking/types.js';
import type { NewTransactionLink } from '../linking/types.js';

/**
 * Result of replacing links in persistence.
 */
export interface LinksSaveResult {
  /** Number of existing links that were cleared (0 if none existed) */
  previousCount: number;
  /** Number of new links saved */
  savedCount: number;
}

/**
 * Port for transaction linking persistence.
 *
 * Domain-shaped: encapsulates the clear-save-readback workflows
 * rather than exposing individual CRUD operations.
 */
export interface ILinkingPersistence {
  /** Load all transactions needed for the linking pipeline */
  loadTransactions(): Promise<Result<UniversalTransactionData[], Error>>;

  /**
   * Clear existing linkable movements and persist new ones.
   * Returns the persisted movements with database-assigned IDs.
   */
  replaceMovements(movements: NewLinkableMovement[]): Promise<Result<LinkableMovement[], Error>>;

  /**
   * Clear existing links and persist new ones.
   * Returns counts for the cleared and saved links.
   */
  replaceLinks(links: NewTransactionLink[]): Promise<Result<LinksSaveResult, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txStore: ILinkingPersistence) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
