import { type TransactionDraft, type Result } from '@exitbook/core';

export interface BatchProcessSummary {
  errors: string[];
  failed: number;
  processed: number;
}

/**
 * Processing context for fund flow analysis in blockchain processors.
 * Provides address information needed to determine transaction direction.
 *
 * Note: All addresses are already normalized (lowercased for case-insensitive blockchains)
 * by blockchain-specific schemas before reaching the processor.
 */
export interface AddressContext {
  /** Primary address being analyzed (the account's address) - already normalized */
  primaryAddress: string;
  /** All user addresses on this blockchain (for detecting internal transfers) - already normalized */
  userAddresses: string[];
}

export type ProcessedTransaction = TransactionDraft;

/**
 * Interface for processing raw data into ProcessedTransaction format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized ProcessedTransaction format.
 */
export interface ITransactionProcessor {
  /**
   * Process normalized data with explicit typed context into ProcessedTransaction objects.
   */
  process(normalizedData: unknown[], context: AddressContext): Promise<Result<ProcessedTransaction[], Error>>;
}
