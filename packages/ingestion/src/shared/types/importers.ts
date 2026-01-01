import type { AccountType, CursorState, ExchangeCredentials, RawTransactionInput } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Canonical import parameters - single source of truth for all import operations.
 * Built once at CLI boundary, passed through all layers, stored in Account.
 */
export interface ImportParams {
  /** Source name (exchange or blockchain identifier) */
  sourceName: string;

  /** Source type (blockchain, exchange-api, or exchange-csv) */
  sourceType: AccountType;

  /** Wallet address (for blockchain imports) */
  address?: string | undefined;

  /** Provider name (for blockchain imports - which API provider to use) */
  providerName?: string | undefined;

  /** Xpub gap limit (for xpub/extended public key imports) */
  xpubGap?: number | undefined;

  /** API credentials (for exchange-api imports) */
  credentials?: ExchangeCredentials | undefined;

  /** CSV directory path (for exchange-csv imports) - subdirectories are recursively scanned */
  csvDirectory?: string | undefined;

  /** Resume cursors per operation type (for crash recovery) */
  cursor?: Record<string, CursorState> | undefined;

  /** Whether to process data after import */
  shouldProcess?: boolean | undefined;

  /** Callback to warn user about single address imports (returns false to abort) */
  onSingleAddressWarning?: (() => Promise<boolean>) | undefined;
}

/**
 * Single batch of imported transactions from streaming import
 */
export interface ImportBatchResult {
  // Successfully fetched and validated transactions in this batch
  rawTransactions: RawTransactionInput[];
  // Transaction type (e.g., "normal", "internal", "token", "beacon_withdrawal" for blockchains, "ledger", "trade" for exchanges)
  transactionType: string;
  // Cursor state for this specific transaction type
  cursor: CursorState;
  // Whether this transaction type has completed (no more batches for this transaction type)
  isComplete: boolean;
  // Warnings about partial data or skipped operations (e.g., missing API keys, unsupported features)
  warnings?: string[] | undefined;
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
