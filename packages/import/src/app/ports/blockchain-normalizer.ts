import type { Result } from 'neverthrow';

import type { ImportSessionMetadata } from './processors.ts';

/**
 * Interface for blockchain-specific normalizers that coordinate
 * provider-specific mappers to produce normalized transactions
 */
export interface IBlockchainNormalizer {
  /**
   * Normalize raw blockchain transaction data to normalized format
   */
  normalize(rawData: unknown, providerId: string, sessionContext: ImportSessionMetadata): Result<unknown, string>;
}
