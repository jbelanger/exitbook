import type { Result } from 'neverthrow';

import type { RawTransactionMetadata } from './importers.ts';
import type { ImportSessionMetadata } from './transaction-processor.interface.ts';

/**
 * Interface for blockchain-specific normalizers that coordinate
 * provider-specific mappers to produce normalized transactions
 */
export interface IBlockchainNormalizer {
  /**
   * Normalize raw blockchain transaction data to normalized format
   */
  normalize(
    rawData: unknown,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<unknown, string>;
}
