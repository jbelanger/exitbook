/**
 * Validation utilities for Coinbase API data formats
 *
 * These utilities provide validation functions for Coinbase API data using
 * the schemas defined in schemas.ts.
 */
import type { z } from 'zod';

import {
  RawCoinbaseAccountSchema,
  RawCoinbaseAccountsResponseSchema,
  RawCoinbaseLedgerEntrySchema,
  RawCoinbaseTransactionSchema,
  RawCoinbaseTransactionsResponseSchema,
} from './schemas.js';

/**
 * Type inference from schemas for use in application code
 */
export type ValidatedRawCoinbaseAccount = z.infer<typeof RawCoinbaseAccountSchema>;
export type ValidatedRawCoinbaseTransaction = z.infer<typeof RawCoinbaseTransactionSchema>;
export type ValidatedRawCoinbaseTransactionsResponse = z.infer<typeof RawCoinbaseTransactionsResponseSchema>;
export type ValidatedRawCoinbaseAccountsResponse = z.infer<typeof RawCoinbaseAccountsResponseSchema>;
export type ValidatedRawCoinbaseLedgerEntry = z.infer<typeof RawCoinbaseLedgerEntrySchema>;

/**
 * Validation results
 */
export interface CoinbaseApiValidationResult<T> {
  data?: T;
  errors?: z.ZodError;
  success: boolean;
}

/**
 * Batch validation result for multiple API responses
 */
export interface CoinbaseApiBatchValidationResult<T> {
  apiEndpoint: string;
  invalid: Array<{ data: unknown; errors: z.ZodError; itemIndex: number }>;
  totalItems: number;
  valid: T[];
}

/**
 * Validate a single Coinbase transaction
 */
export function validateCoinbaseTransaction(
  data: unknown
): CoinbaseApiValidationResult<ValidatedRawCoinbaseTransaction> {
  const result = RawCoinbaseTransactionSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

/**
 * Validate multiple Coinbase transactions
 */
export function validateCoinbaseTransactions(
  data: unknown[]
): CoinbaseApiBatchValidationResult<ValidatedRawCoinbaseTransaction> {
  const valid: ValidatedRawCoinbaseTransaction[] = [];
  const invalid: Array<{ data: unknown; errors: z.ZodError; itemIndex: number }> = [];

  data.forEach((item, index) => {
    const result = validateCoinbaseTransaction(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors, itemIndex: index });
    }
  });

  return {
    apiEndpoint: 'transactions',
    invalid,
    totalItems: data.length,
    valid,
  };
}

/**
 * Validate a Coinbase transactions API response
 */
export function validateCoinbaseTransactionsResponse(
  data: unknown
): CoinbaseApiValidationResult<ValidatedRawCoinbaseTransactionsResponse> {
  const result = RawCoinbaseTransactionsResponseSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

/**
 * Validate a Coinbase accounts API response
 */
export function validateCoinbaseAccountsResponse(
  data: unknown
): CoinbaseApiValidationResult<ValidatedRawCoinbaseAccountsResponse> {
  const result = RawCoinbaseAccountsResponseSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

/**
 * Helper to format validation errors for logging
 */
export function formatCoinbaseValidationErrors<T>(result: CoinbaseApiBatchValidationResult<T>): string {
  if (result.invalid.length === 0) {
    return `All ${result.totalItems} Coinbase ${result.apiEndpoint} items validated successfully`;
  }

  const errorSummary = result.invalid
    .slice(0, 3) // Show first 3 errors
    .map(({ errors, itemIndex }) => {
      const fieldErrors = errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return `Item ${itemIndex + 1}: ${fieldErrors}`;
    })
    .join(' | ');

  const additionalErrors = result.invalid.length > 3 ? ` and ${result.invalid.length - 3} more` : '';

  return `${result.invalid.length} invalid Coinbase ${result.apiEndpoint} items out of ${result.totalItems}. Valid: ${result.valid.length}. Errors: ${errorSummary}${additionalErrors}`;
}
