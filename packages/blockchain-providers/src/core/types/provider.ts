import type { CursorState, CursorType, PaginationCursor } from '@exitbook/core';
import type { RateLimitConfig } from '@exitbook/http';
import type { Result } from 'neverthrow';

import type { NormalizedTransactionBase } from '../schemas/normalized-transaction.ts';

import type { TransactionWithRawData } from './common.js';
import type { OneShotOperation, ProviderOperationType, StreamingOperation } from './operations.js';

export interface ProviderCapabilities {
  /**
   * Supported operation types
   */
  supportedOperations: ProviderOperationType[];

  /**
   * Supported transaction types for getAddressTransactions operation
   * Chain-specific categories (e.g., ['normal', 'internal', 'token', 'beacon_withdrawal'] for EVM)
   * Used to determine which transaction subtypes a provider can fetch
   */
  supportedTransactionTypes?: string[];

  /**
   * Cursor types this provider can accept for resumption
   * Enables cross-provider failover for compatible cursor types
   * Optional during Phase 1 migration - providers will implement incrementally
   */
  supportedCursorTypes?: CursorType[];

  /**
   * Preferred cursor type for this provider (most efficient)
   * Used when starting fresh or when multiple options available
   * Optional during Phase 1 migration - providers will implement incrementally
   */
  preferredCursorType?: CursorType;

  /**
   * Replay window applied when failing over FROM a different provider
   * Prevents off-by-one gaps; duplicates absorbed by dedup keys
   */
  replayWindow?: {
    blocks?: number; // For blockNumber cursors (EVM, Substrate)
    minutes?: number; // For timestamp cursors (Bitcoin, Solana) or fallback
    transactions?: number; // For txHash cursors (Bitcoin UTXO chaining)
  };
}

/**
 * Streaming batch result with Result wrapper
 * Follows neverthrow pattern for consistent error handling
 */
export interface StreamingBatchResult<T extends NormalizedTransactionBase = NormalizedTransactionBase> {
  data: TransactionWithRawData<T>[];
  cursor: CursorState;
  isComplete: boolean;
}

export interface IBlockchainProvider {
  // Rate limit benchmarking
  benchmarkRateLimit(
    maxRequestsPerSecond: number,
    numRequestsPerTest: number,
    testBurstLimits?: boolean,
    customRates?: number[]
  ): Promise<{
    burstLimits?: { limit: number; success: boolean }[];
    maxSafeRate: number;
    recommended: RateLimitConfig;
    testResults: { rate: number; responseTimeMs?: number; success: boolean }[];
  }>;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;
  // Universal execution method - all operations go through this
  execute<T>(operation: OneShotOperation): Promise<Result<T, Error>>;
  // Health and connectivity - returns Result to allow special error handling (e.g., RateLimitError)
  isHealthy(): Promise<Result<boolean, Error>>;

  readonly name: string;
  readonly rateLimit: RateLimitConfig;

  /**
   * Execute operation with streaming pagination
   *
   * IMPORTANT: This method yields Result<T, Error> to maintain consistency with
   * the repository's neverthrow pattern. Errors are yielded as err(Error) rather
   * than thrown directly. Consumers should check each yielded result with .isErr().
   *
   * @param operation - The operation to execute
   * @param cursor - Optional cursor state to resume from
   * @returns AsyncIterator yielding Result-wrapped batches with cursor state
   *
   * @example
   * ```typescript
   * const iterator = provider.executeStreaming(operation, cursor);
   * for await (const batchResult of iterator) {
   *   if (batchResult.isErr()) {
   *     logger.error('Batch failed:', batchResult.error);
   *     // Handle error or break
   *     break;
   *   }
   *   const { data, cursor } = batchResult.value;
   *   // Process batch...
   * }
   * ```
   */
  executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    cursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;

  /**
   * Extract all available cursor types from a transaction
   * Providers should return as many cursor types as possible to maximize failover options
   *
   * @param transaction - Normalized transaction
   * @returns Array of all extractable cursor types
   *
   * @example
   * // EVM transaction provides both blockNumber and timestamp
   * extractCursors(evmTx) => [
   *   { type: 'blockNumber', value: 15000000 },
   *   { type: 'timestamp', value: 1640000000000 }
   * ]
   */
  extractCursors(transaction: unknown): PaginationCursor[];

  /**
   * Apply replay window to a cursor for safe failover
   * Returns adjusted cursor that will overlap with previous provider's data
   *
   * @param cursor - Cursor from a different provider
   * @returns Adjusted cursor with replay window applied
   *
   * @example
   * // Original cursor: block 15000000
   * // Replay window: 5 blocks
   * // Returns: block 14999995
   */
  applyReplayWindow(cursor: PaginationCursor): PaginationCursor;

  /**
   * Cleanup resources (HTTP connections, timers, etc.)
   * Called by ProviderManager during shutdown
   */
  destroy(): void;
}
