import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Error type for normalization failures.
 * Discriminated union to distinguish between safe skips and actual errors.
 */
export type NormalizationError =
  | {
      reason: string;
      type: 'skip';
    }
  | {
      message: string;
      type: 'error';
    };

/**
 * Interface for blockchain-specific normalizers that coordinate
 * provider-specific mappers to produce normalized transactions
 */
export interface IBlockchainNormalizer {
  /**
   * Normalize raw blockchain transaction data to normalized format
   * Returns:
   * - ok(data) if normalization succeeded
   * - err({ type: 'skip', reason }) if transaction should be safely ignored (non-asset operations, irrelevant txs)
   * - err({ type: 'error', message }) if normalization failed due to invalid data
   */
  normalize(
    rawData: unknown,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<unknown, NormalizationError>;
}
