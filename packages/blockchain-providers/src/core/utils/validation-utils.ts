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
  return <TArgs extends unknown[]>(mapFn: (input: TInput, ...args: TArgs) => Result<TOutput, NormalizationError>) => {
    return (input: unknown, ...args: TArgs): Result<TOutput, NormalizationError> => {
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
      const mapResult = mapFn(inputResult.data, ...args);
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

/**
 * Validates only the output of a mapper function (for use when input is pre-validated by HTTP client).
 * Input data has already been validated by HTTP client schema validation.
 *
 * @param outputSchema - Zod schema for validating normalized output data
 * @param mapperName - Name of the mapper for error messages
 * @returns The validated output data
 *
 * @example
 * ```typescript
 * export function mapAlchemyTransaction(
 *   rawData: AlchemyAssetTransfer, // Already validated by HTTP client
 * ): Result<EvmTransaction, NormalizationError> {
 *   const transaction: EvmTransaction = { ... };
 *   return validateOutput(transaction, EvmTransactionSchema, 'AlchemyTransaction');
 * }
 * ```
 */
export function validateOutput<TOutput>(
  output: TOutput,
  outputSchema: ZodSchema<TOutput>,
  mapperName: string
): Result<TOutput, NormalizationError> {
  const outputResult = outputSchema.safeParse(output);
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
}
