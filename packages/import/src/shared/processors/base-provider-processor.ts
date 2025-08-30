import type { UniversalTransaction } from '@crypto/core';
import { type Result, err } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { IProviderProcessor, ValidationResult } from './interfaces.ts';

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
   */
  transform(rawData: TRawData, walletAddresses: string[]): Result<UniversalTransaction, string> {
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
    return this.transformValidated(validationResult.data, walletAddresses);
  }

  /**
   * Transform raw data after validation has passed.
   * This method is called only with validated data.
   */
  protected abstract transformValidated(
    rawData: TRawData,
    walletAddresses: string[]
  ): Result<UniversalTransaction, string>;

  /**
   * Validate method for backward compatibility.
   * This will be removed once we update the interfaces.
   */
  validate(rawData: TRawData): ValidationResult {
    const result = this.schema.safeParse(rawData);

    if (result.success) {
      return { isValid: true };
    }

    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });

    return {
      errors,
      isValid: false,
    };
  }
}
