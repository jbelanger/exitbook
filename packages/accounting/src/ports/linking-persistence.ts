import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

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
 * Domain-shaped: encapsulates link persistence and projection lifecycle.
 * Linkable movements are built in-memory — only links are persisted.
 */
export interface ILinkingPersistence {
  /** Load all transactions needed for the linking pipeline */
  loadTransactions(): Promise<Result<UniversalTransactionData[], Error>>;

  /**
   * Clear existing links and persist new ones.
   * Returns counts for the cleared and saved links.
   */
  replaceLinks(links: NewTransactionLink[]): Promise<Result<LinksSaveResult, Error>>;

  /** Mark links projection as building (call before transaction for external visibility). */
  markLinksBuilding(): Promise<Result<void, Error>>;

  /** Mark links projection as fresh. */
  markLinksFresh(): Promise<Result<void, Error>>;

  /** Mark links projection as failed. */
  markLinksFailed(): Promise<Result<void, Error>>;

  /** Execute a callback where all port operations share a single atomic transaction. */
  withTransaction<T>(fn: (txStore: ILinkingPersistence) => Promise<Result<T, Error>>): Promise<Result<T, Error>>;
}
