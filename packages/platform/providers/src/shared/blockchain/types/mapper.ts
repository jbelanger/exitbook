import type { ImportSessionMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import type { NormalizationError } from './errors.ts';

/**
 * Interface for blockchain-specific raw data mappers that transform
 * provider-specific data formats into normalized blockchain transactions
 */
export interface IRawDataMapper<TRawData, TNormalizedData> {
  /**
   * Map raw provider data to normalized format
   * Returns:
   * - ok(data) if mapping succeeded
   * - err({ type: 'skip', reason }) if transaction should be safely ignored
   * - err({ type: 'error', message }) if mapping failed due to invalid data
   */
  map(
    rawData: TRawData,
    providerId: string,
    context: ImportSessionMetadata
  ): Result<TNormalizedData, NormalizationError>;
}
