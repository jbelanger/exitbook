import { type Result, err } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { UniversalBlockchainTransaction } from '../../blockchains/shared/types.ts';
import type { IProviderProcessor, ImportSessionMetadata } from './interfaces.ts';

/**
 * Abstract base class for provider processors that handles validation automatically.
 * Implementing classes only need to provide the schema and implement the validated transform logic.
 */
export abstract class BaseProviderProcessor<TRawData> implements IProviderProcessor<TRawData> {
  /**
   * Schema used to validate raw data before transformation.
   * Must be implemented by concrete processor classes.
   */
  protected abstract readonly schema: ZodSchema;

  /**
   * Public transform method that handles validation internally and delegates to transformValidated.
   * Returns array of UniversalBlockchainTransaction for type-safe consumption by transaction processors.
   */
  transform(rawData: TRawData, context: ImportSessionMetadata): Result<UniversalBlockchainTransaction[], string> {
    // Validate input data first
    const validationResult = this.schema.safeParse(rawData);
    if (!validationResult.success) {
      const errors = validationResult.error.issues.map(issue => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
        return `${issue.message}${path}`;
      });
      return err(`Invalid ${this.constructor.name} data: ${errors.join(', ')}`);
    }

    // Delegate to concrete implementation with validated data
    return this.transformValidated(validationResult.data, context);
  }

  /**
   * Transform raw data after validation has passed.
   * This method is called only with validated data and rich session context.
   * Must return array of UniversalBlockchainTransaction for type safety.
   */
  protected abstract transformValidated(
    rawData: TRawData,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string>;
}
