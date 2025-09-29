import type { Result } from 'neverthrow';

import type { ImportSessionMetadata } from './processors.js';

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IRawDataMapper<TRawData, TNormalizedData> {
  map(rawData: TRawData, sessionContext: ImportSessionMetadata): Result<TNormalizedData, string>;
}
