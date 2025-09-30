import type { IRawDataMapper } from '@exitbook/import/app/ports/raw-data-mappers.js';
import { type Result, err } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { RawTransactionMetadata } from '../../../app/ports/importers.ts';
import type { ImportSessionMetadata } from '../../../app/ports/transaction-processor.interface.ts';

/**
 * Abstract base class for raw data transformers that handles validation automatically.
 * Implementing classes only need to provide the schema and implement the validated transform logic.
 */
export abstract class BaseRawDataMapper<TRawData, TNormalizedData>
  implements IRawDataMapper<TRawData, TNormalizedData>
{
  /**
   * Schema used to validate raw data before transformation.
   * Must be implemented by concrete processor classes.
   */
  protected abstract readonly schema: ZodSchema;

  /**
   * Transform raw data after validation has passed.
   * This method is called only with validated data and rich session context.
   * Must return array of UniversalBlockchainTransaction for type safety.
   */
  protected abstract mapInternal(
    rawData: TRawData,
    metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<TNormalizedData, string>;

  /**
   * Public transform method that handles validation internally and delegates to transformValidated.
   * Returns array of UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   */
  map(
    rawData: TRawData,
    metadata: RawTransactionMetadata,
    context: ImportSessionMetadata
  ): Result<TNormalizedData, string> {
    // Validate input data first
    const validationResult = this.schema.safeParse(rawData);
    if (!validationResult.success) {
      const errors = validationResult.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
        return `${issue.message}${path}`;
      });
      return err(`Invalid ${this.constructor.name} data: ${errors.join(', ')}`);
    }

    // Delegate to concrete implementation with validated data
    return this.mapInternal(validationResult.data as TRawData, metadata, context);
  }
}
