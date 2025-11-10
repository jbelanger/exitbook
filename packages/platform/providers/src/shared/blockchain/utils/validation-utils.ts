import type { SourceMetadata } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import type { ZodSchema } from 'zod';

import type { NormalizationError } from '../types/errors.js';

/**
 * Higher-order function that wraps a pure mapper function with input/output validation.
 * Restores the validation guarantees that were present in the original BaseRawDataMapper class
 * while preserving the benefits of pure functions (testability, composability).
 *
 * @param inputSchema - Zod schema for validating raw input data
 * @param outputSchema - Zod schema for validating normalized output data
 * @param mapperName - Name of the mapper for error messages
 * @returns A function that accepts a mapper and returns a validated version
 *
 * @example
 * ```typescript
 * // Internal pure function (no validation, easily testable)
 * function mapBlockstreamTransactionInternal(
 *   rawData: BlockstreamTransaction,
 *   sourceContext: SourceMetadata,
 *   chainConfig: BitcoinChainConfig
 * ): Result<BitcoinTransaction, NormalizationError> {
 *   // ... mapping logic
 * }
 *
 * // Exported validated version
 * export const mapBlockstreamTransaction = withValidation(
 *   BlockstreamTransactionSchema,
 *   BitcoinTransactionSchema,
 *   'BlockstreamTransaction'
 * )(mapBlockstreamTransactionInternal);
 * ```
 */
export function withValidation<TInput, TOutput>(
  inputSchema: ZodSchema<TInput>,
  outputSchema: ZodSchema<TOutput>,
  mapperName: string
) {
  return <TArgs extends unknown[]>(
    mapFn: (input: TInput, context: SourceMetadata, ...args: TArgs) => Result<TOutput, NormalizationError>
  ) => {
    return (input: unknown, context: SourceMetadata, ...args: TArgs): Result<TOutput, NormalizationError> => {
      // Validate input
      const inputResult = inputSchema.safeParse(input);
      if (!inputResult.success) {
        const errors = inputResult.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
          return `${issue.message}${path}`;
        });
        return err({
          message: `Invalid ${mapperName} input: ${errors.join(', ')}`,
          type: 'error',
        });
      }

      // Call mapper with validated input
      const mapResult = mapFn(inputResult.data, context, ...args);
      if (mapResult.isErr()) {
        return mapResult;
      }

      // Validate output
      const outputResult = outputSchema.safeParse(mapResult.value);
      if (!outputResult.success) {
        const errors = outputResult.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
          return `${issue.message}${path}`;
        });
        return err({
          message: `Invalid ${mapperName} output: ${errors.join(', ')}`,
          type: 'error',
        });
      }

      return ok(outputResult.data);
    };
  };
}
