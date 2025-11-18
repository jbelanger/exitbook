/**
 * Utility functions for cursor state management
 *
 * These helpers are used by providers to construct cursor states
 * for streaming pagination and resumption.
 */

import type { CursorState, PaginationCursor } from '@exitbook/core';

/**
 * Configuration for cursor state building
 */
export interface CursorStateConfig<T> {
  /**
   * Transactions in the current batch (after deduplication)
   */
  transactions: { normalized: T; raw: unknown }[];

  /**
   * Function to extract cursors from a normalized transaction
   */
  extractCursors: (tx: T) => PaginationCursor[];

  /**
   * Total number of transactions fetched so far (cumulative)
   */
  totalFetched: number;

  /**
   * Provider name for metadata
   */
  providerName: string;

  /**
   * Page token from API response (if available)
   */
  pageToken?: string | undefined;

  /**
   * Whether this is the last batch (no more data available)
   */
  isComplete: boolean;
}

/**
 * Build cursor state from batch result
 *
 * Constructs a complete cursor state including:
 * - Primary cursor (pageToken or blockNumber fallback)
 * - Alternative cursors for cross-provider failover
 * - Last transaction ID for deduplication
 * - Metadata for tracking progress
 *
 * @param config - Configuration for cursor state building
 * @returns Complete cursor state for this batch
 */
export function buildCursorState<T extends { id: string }>(config: CursorStateConfig<T>): CursorState {
  const { transactions, extractCursors, totalFetched, providerName, pageToken, isComplete } = config;

  // Extract cursors from last transaction
  const lastTx = transactions[transactions.length - 1]!; // Safe: caller ensures transactions.length > 0
  const cursors = extractCursors(lastTx.normalized);
  const lastTransactionId = lastTx.normalized.id;

  // Build cursor state
  return {
    primary: pageToken
      ? { type: 'pageToken', value: pageToken, providerName }
      : cursors.find((c) => c.type === 'blockNumber') || { type: 'blockNumber', value: 0 },
    alternatives: cursors,
    lastTransactionId,
    totalFetched,
    metadata: {
      providerName,
      updatedAt: Date.now(),
      isComplete,
    },
  };
}

/**
 * Create a synthetic cursor for operations that complete with no data.
 *
 * Used when an operation is valid but returns no transactions, such as:
 * - Internal transactions bundled into another operation (Moralis includes internal txs in regular transactions)
 * - Operations not supported by the provider but that should signal completion rather than error
 * - Any legitimate scenario where a streaming operation completes with zero data
 *
 * The synthetic cursor includes:
 * - A zero-value blockNumber cursor (universally resumable)
 * - A descriptive lastTransactionId indicating it's an empty result
 * - Completion metadata to signal the operation finished successfully
 *
 * @param config - Configuration for the empty cursor
 * @returns Complete cursor state marking successful completion with no data
 *
 * @example
 * ```typescript
 * // For Moralis internal transactions (bundled into regular transactions)
 * yield ok({
 *   data: [],
 *   cursor: createEmptyCompletionCursor({
 *     providerName: this.name,
 *     operationType: 'internal',
 *     identifier: operation.address,
 *   }),
 * });
 * ```
 */
export function createEmptyCompletionCursor(config: {
  identifier?: string | undefined;
  operationType: string;
  providerName: string;
}): CursorState {
  return {
    primary: { type: 'blockNumber', value: 0 },
    lastTransactionId: `${config.identifier || 'unknown'}:${config.operationType}:empty`,
    totalFetched: 0,
    metadata: {
      providerName: config.providerName,
      updatedAt: Date.now(),
      isComplete: true,
    },
  };
}
