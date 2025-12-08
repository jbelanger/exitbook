import { UniversalTransactionSchema } from '@exitbook/core';
import type { Result } from 'neverthrow';
import type z from 'zod';

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

export const ProcessedTransactionSchema = UniversalTransactionSchema.omit({
  id: true,
  accountId: true,
});
export type ProcessedTransaction = z.infer<typeof ProcessedTransactionSchema>;

/**
 * Interface for processing raw data into ProcessedTransaction format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized ProcessedTransaction format.
 */
export interface ITransactionProcessor {
  /**
   * Process normalized data with explicit typed context into ProcessedTransaction objects.
   */
  process(normalizedData: unknown[], context: ProcessingContext): Promise<Result<ProcessedTransaction[], string>>;
}
