import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import type { Result } from 'neverthrow';

import type { NormalizationError } from './blockchain-normalizer.interface.ts';

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IRawDataMapper<TRawData, TNormalizedData> {
  map(
    rawData: TRawData,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<TNormalizedData, NormalizationError>;
}
