import type { ImportSessionMetadata } from '@exitbook/core';
import { type Result, err } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { NormalizationError } from '../types/errors.js';

/**
 * Abstract base class for raw data transformers that handles validation automatically.
 * Implementing classes only need to provide the schemas and implement the validated transform logic.
 */
export abstract class BaseRawDataMapper<TRawData, TNormalizedData> {
  /**
   * Schema used to validate raw data before transformation.
   * Must be implemented by concrete processor classes.
   */
  protected abstract readonly inputSchema: ZodSchema;

  /**
   * Schema used to validate normalized data after transformation.
   * Must be implemented by concrete processor classes.
   */
  protected abstract readonly outputSchema: ZodSchema;

  /**
   * Transform raw data after validation has passed.
   * This method is called only with validated data and rich session context.
   * Must return array of UniversalBlockchainTransaction for type safety.
   */
  protected abstract mapInternal(
    rawData: TRawData,
    sourceContext: ImportSessionMetadata
  ): Result<TNormalizedData, NormalizationError>;

  /**
   * Public transform method that handles validation internally and delegates to transformValidated.
   * Returns array of UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   */
  map(rawData: TRawData, context: ImportSessionMetadata): Result<TNormalizedData, NormalizationError> {
    const inputValidationResult = this.inputSchema.safeParse(rawData);
    if (!inputValidationResult.success) {
      const errors = inputValidationResult.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
        return `${issue.message}${path}`;
      });
      return err({
        message: `Invalid ${this.constructor.name} input data: ${errors.join(', ')}`,
        type: 'error',
      });
    }

    // Delegate to concrete implementation with validated data
    const transformResult = this.mapInternal(inputValidationResult.data as TRawData, context);

    if (transformResult.isErr()) {
      return transformResult;
    }

    // Validate output data
    const outputValidationResult = this.outputSchema.safeParse(transformResult.value);
    if (!outputValidationResult.success) {
      const errors = outputValidationResult.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
        return `${issue.message}${path}`;
      });
      return err({
        message: `Invalid ${this.constructor.name} output data: ${errors.join(', ')}`,
        type: 'error',
      });
    }

    return transformResult;
  }
}
