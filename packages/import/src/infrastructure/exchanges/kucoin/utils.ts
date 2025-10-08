/**
 * Validation utilities for KuCoin CSV data formats
 *
 * These utilities provide validation functions for KuCoin CSV data using
 * the schemas defined in schemas.ts.
 */
import type { z } from 'zod';

import type { CsvKuCoinRawDataSchema } from './schemas.js';
import {
  CsvAccountHistoryRowSchema,
  CsvDepositWithdrawalRowSchema,
  CsvOrderSplittingRowSchema,
  CsvSpotOrderRowSchema,
} from './schemas.js';

/**
 * Type inference from schemas for use in application code
 */
export type ValidatedCsvSpotOrderRow = z.infer<typeof CsvSpotOrderRowSchema>;
export type ValidatedCsvDepositWithdrawalRow = z.infer<typeof CsvDepositWithdrawalRowSchema>;
export type ValidatedCsvAccountHistoryRow = z.infer<typeof CsvAccountHistoryRowSchema>;
export type ValidatedCsvOrderSplittingRow = z.infer<typeof CsvOrderSplittingRowSchema>;
export type ValidatedCsvKuCoinRawData = z.infer<typeof CsvKuCoinRawDataSchema>;

/**
 * Validation results for individual sections
 */
export interface KuCoinCsvValidationResult<T> {
  data?: T | undefined;
  errors?: z.ZodError | undefined;
  success: boolean;
}

/**
 * Batch validation result for KuCoin data sections
 */
export interface KuCoinCsvBatchValidationResult<T> {
  invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[];
  section: string;
  totalRows: number;
  valid: T[];
}

/**
 * Validate KuCoin spot order rows
 */
export function validateKuCoinSpotOrders(data: unknown[]): KuCoinCsvBatchValidationResult<ValidatedCsvSpotOrderRow> {
  const valid: ValidatedCsvSpotOrderRow[] = [];
  const invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[] = [];

  data.forEach((item, index) => {
    const result = CsvSpotOrderRowSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ data: item, errors: result.error, rowIndex: index });
    }
  });

  return { invalid, section: 'spot-orders', totalRows: data.length, valid };
}

/**
 * Validate KuCoin deposit/withdrawal rows
 */
export function validateKuCoinDepositsWithdrawals(
  data: unknown[]
): KuCoinCsvBatchValidationResult<ValidatedCsvDepositWithdrawalRow> {
  const valid: ValidatedCsvDepositWithdrawalRow[] = [];
  const invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[] = [];

  data.forEach((item, index) => {
    const result = CsvDepositWithdrawalRowSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ data: item, errors: result.error, rowIndex: index });
    }
  });

  return { invalid, section: 'deposits-withdrawals', totalRows: data.length, valid };
}

/**
 * Validate KuCoin account history rows
 */
export function validateKuCoinAccountHistory(
  data: unknown[]
): KuCoinCsvBatchValidationResult<ValidatedCsvAccountHistoryRow> {
  const valid: ValidatedCsvAccountHistoryRow[] = [];
  const invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[] = [];

  data.forEach((item, index) => {
    const result = CsvAccountHistoryRowSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ data: item, errors: result.error, rowIndex: index });
    }
  });

  return { invalid, section: 'account-history', totalRows: data.length, valid };
}

/**
 * Validate KuCoin order-splitting rows
 */
export function validateKuCoinOrderSplitting(
  data: unknown[]
): KuCoinCsvBatchValidationResult<ValidatedCsvOrderSplittingRow> {
  const valid: ValidatedCsvOrderSplittingRow[] = [];
  const invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[] = [];

  data.forEach((item, index) => {
    const result = CsvOrderSplittingRowSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ data: item, errors: result.error, rowIndex: index });
    }
  });

  return { invalid, section: 'order-splitting', totalRows: data.length, valid };
}

/**
 * Helper to format validation errors for logging
 */
export function formatKuCoinValidationErrors<T>(result: KuCoinCsvBatchValidationResult<T>): string {
  if (result.invalid.length === 0) {
    return `All ${result.totalRows} KuCoin ${result.section} rows validated successfully`;
  }

  const errorSummary = result.invalid
    .slice(0, 3) // Show first 3 errors
    .map(({ errors, rowIndex }) => {
      const fieldErrors = errors.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return `Row ${rowIndex + 1}: ${fieldErrors}`;
    })
    .join(' | ');

  const additionalErrors = result.invalid.length > 3 ? ` and ${result.invalid.length - 3} more` : '';

  return `${result.invalid.length} invalid KuCoin ${result.section} rows out of ${result.totalRows}. Valid: ${result.valid.length}. Errors: ${errorSummary}${additionalErrors}`;
}
