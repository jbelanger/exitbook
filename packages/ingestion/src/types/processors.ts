import type { UniversalTransaction } from '@exitbook/core';
import type { Result } from 'neverthrow';

export interface ProcessResult {
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
export interface ProcessingContext {
  /** Primary address being analyzed (the account's address) - already normalized */
  primaryAddress: string;
  /** All user addresses on this blockchain (for detecting internal transfers) - already normalized */
  userAddresses: string[];
}

/**
 * Interface for processing raw data into UniversalTransaction format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized UniversalTransaction format.
 */
export interface ITransactionProcessor {
  /**
   * Process normalized data with explicit typed context into UniversalTransaction objects.
   */
  process(normalizedData: unknown[], context: ProcessingContext): Promise<Result<UniversalTransaction[], string>>;
}
