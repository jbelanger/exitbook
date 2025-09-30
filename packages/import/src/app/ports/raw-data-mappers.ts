import type { Result } from 'neverthrow';

import type { RawTransactionMetadata } from './importers.ts';
import type { ImportSessionMetadata } from './transaction-processor.interface.ts';

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IRawDataMapper<TRawData, TNormalizedData> {
  map(
    rawData: TRawData,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<TNormalizedData, string>;
}
