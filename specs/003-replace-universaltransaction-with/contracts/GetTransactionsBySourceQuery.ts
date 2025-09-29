import { Result } from 'neverthrow';
import { ProcessedTransaction, RepositoryError } from '@crypto/core';

/**
 * Query: Get Processed Transactions by Source
 *
 * Purpose: Retrieve ProcessedTransactions filtered by source type and venue/chain
 * for analysis, reporting, and debugging purposes.
 */
export interface GetTransactionsBySourceQuery {
  readonly source: {
    readonly kind: 'exchange' | 'blockchain';
    readonly venue?: string; // For exchanges: 'kraken'
    readonly chain?: string; // For blockchains: 'ethereum'
  };
  readonly limit?: number; // Max results (default 100)
  readonly offset?: number; // Pagination offset (default 0)
  readonly requestId: string; // For query tracing/debugging
  readonly dateRange?: {
    readonly from: string; // ISO timestamp
    readonly to: string; // ISO timestamp
  };
}

/**
 * Query result with pagination metadata
 */
export interface TransactionsBySourceResult {
  readonly transactions: ProcessedTransaction[];
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly executedAt: string; // ISO timestamp
}

/**
 * Query Handler Interface
 */
export interface GetTransactionsBySourceQueryHandler {
  /**
   * Execute transaction retrieval query
   *
   * Input Parameters:
   * - query: GetTransactionsBySourceQuery with source filters
   *
   * Validation Rules:
   * - Source kind must be 'exchange' or 'blockchain'
   * - If kind is 'exchange', venue must be provided
   * - If kind is 'blockchain', chain must be provided
   * - Limit must be between 1 and 1000 (default 100)
   * - Offset must be non-negative (default 0)
   * - Date range timestamps must be valid ISO format
   * - Date range 'from' must be <= 'to'
   *
   * Business Rules:
   * - Query should be read-only (no side effects)
   * - Results ordered by timestamp descending (newest first)
   * - Pagination metadata must be accurate
   * - Empty result set is valid (not an error)
   *
   * Events Produced: None (read-only query)
   */
  execute(query: GetTransactionsBySourceQuery): Promise<Result<TransactionsBySourceResult, RepositoryError>>;
}
