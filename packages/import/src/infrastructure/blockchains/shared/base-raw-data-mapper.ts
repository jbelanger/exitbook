import { type Result, err } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { ImportSessionMetadata } from '../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';
import type { IRawDataMapper } from '../../../app/ports/raw-data-mappers.ts';

/**
 * Abstract base class for raw data transformers that handles validation automatically.
 * Implementing classes only need to provide the schema and implement the validated transform logic.
 */
export abstract class BaseRawDataMapper<TRawData> implements IRawDataMapper<TRawData> {
  /**
   * Schema used to validate raw data before transformation.
   * Must be implemented by concrete processor classes.
   */
  protected abstract readonly schema: ZodSchema;

  /**
   * Public transform method that handles validation internally and delegates to transformValidated.
   * Returns array of UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   */
  map(rawData: TRawData, context: ImportSessionMetadata): Result<UniversalBlockchainTransaction[], string> {
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
    return this.mapInternal(validationResult.data as TRawData, context);
  }

  /**
   * Transform raw data after validation has passed.
   * This method is called only with validated data and rich session context.
   * Must return array of UniversalBlockchainTransaction for type safety.
   */
  protected abstract mapInternal(
    rawData: TRawData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string>;
}
