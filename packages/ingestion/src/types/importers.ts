import type { CursorState, RawTransactionInput } from '@exitbook/core';
import type { ExchangeCredentials } from '@exitbook/exchanges-providers';
import type { Result } from 'neverthrow';

export interface ImportParams {
  address?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  csvDirectories?: string[] | undefined;
  cursor?: Record<string, CursorState> | undefined;
  providerName?: string | undefined;
}

/**
 * Single batch of imported transactions from streaming import
 */
export interface ImportBatchResult {
  // Successfully fetched and validated transactions in this batch
  rawTransactions: RawTransactionInput[];
  // Operation type (e.g., "normal", "internal", "token" for blockchains, "ledger", "trade" for exchanges)
  operationType: string;
  // Cursor state for this specific operation type
  cursor: CursorState;
  // Whether this operation type has completed (no more batches for this operation)
  isComplete: boolean;
}

export interface ImportRunResult {
  // Successfully fetched and validated transactions
  rawTransactions: RawTransactionInput[];
  // Map of cursor states per operation type for resumption
  // e.g., { "ledger": {...}, "trade": {...} } for exchanges
  // e.g., { "normal": {...}, "internal": {...}, "token": {...} } for blockchains
  // e.g., { "account-123": {...}, "account-456": {...} } for Coinbase
  cursorUpdates?: Record<string, CursorState> | undefined;
  // Metadata about the import run (e.g., total fetched, date ranges)
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Interface for importing raw data from external sources.
 * Each importer is responsible for fetching data from a specific source
 * (exchange API, blockchain API, CSV files, etc.) and storing it as raw JSON.
 */
export interface IImporter {
  /**
   * Streaming import - yields batches as they're fetched
   * Enables memory-bounded processing and mid-import resumption
   *
   * Optional during migration - blockchain importers should implement this,
   * exchange importers may implement later
   *
   * @param params - Import parameters including optional resume cursors
   * @returns AsyncIterator yielding Result-wrapped batches
   */
  importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>>;
}
