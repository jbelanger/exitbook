/**
 * Validation utilities for Ledger Live CSV data formats
 *
 * These utilities provide validation functions for Ledger Live CSV data using
 * the schemas defined in schemas.ts.
 */
import type { z } from 'zod';

import { CsvLedgerLiveOperationRowSchema } from './schemas.js';

/**
 * Type inference from schema for use in application code
 */
export type ValidatedCsvLedgerLiveOperationRow = z.infer<typeof CsvLedgerLiveOperationRowSchema>;

/**
 * Validation result for individual row validation
 */
export interface LedgerLiveCsvValidationResult {
  data?: ValidatedCsvLedgerLiveOperationRow | undefined;
  errors?: z.ZodError | undefined;
  success: boolean;
}

/**
 * Batch validation result for multiple rows
 */
export interface LedgerLiveCsvBatchValidationResult {
  invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[];
  totalRows: number;
  valid: ValidatedCsvLedgerLiveOperationRow[];
}

/**
 * Validate a single Ledger Live CSV row
 */
export function validateLedgerLiveCsvRow(data: unknown): LedgerLiveCsvValidationResult {
  const result = CsvLedgerLiveOperationRowSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

/**
 * Validate multiple Ledger Live CSV rows in batch
 */
export function validateLedgerLiveCsvRows(data: unknown[]): LedgerLiveCsvBatchValidationResult {
  const valid: ValidatedCsvLedgerLiveOperationRow[] = [];
  const invalid: { data: unknown; errors: z.ZodError; rowIndex: number }[] = [];

  data.forEach((item, index) => {
    const result = validateLedgerLiveCsvRow(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors, rowIndex: index });
    }
  });

  return {
    invalid,
    totalRows: data.length,
    valid,
  };
}

/**
 * Helper to format validation errors for logging
 */
export function formatLedgerLiveValidationErrors(result: LedgerLiveCsvBatchValidationResult): string {
  if (result.invalid.length === 0) {
    return `All ${result.totalRows} Ledger Live CSV rows validated successfully`;
  }

  const errorSummary = result.invalid
    .slice(0, 3) // Show first 3 errors
    .map(({ errors, rowIndex }) => {
      const fieldErrors = errors.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return `Row ${rowIndex + 1}: ${fieldErrors}`;
    })
    .join(' | ');

  const additionalErrors = result.invalid.length > 3 ? ` and ${result.invalid.length - 3} more` : '';

  return `${result.invalid.length} invalid Ledger Live CSV rows out of ${result.totalRows}. Valid: ${result.valid.length}. Errors: ${errorSummary}${additionalErrors}`;
}

/**
 * Helper to extract accounts from validated Ledger Live data
 */
export function extractAccountsFromValidatedData(validatedRows: ValidatedCsvLedgerLiveOperationRow[]): string[] {
  const accounts = new Set<string>();
  validatedRows.forEach((row) => {
    accounts.add(row['Account Name']);
  });
  return Array.from(accounts).sort();
}

/**
 * Helper to extract currency tickers from validated Ledger Live data
 */
export function extractCurrenciesFromValidatedData(validatedRows: ValidatedCsvLedgerLiveOperationRow[]): string[] {
  const currencies = new Set<string>();
  validatedRows.forEach((row) => {
    currencies.add(row['Currency Ticker']);
  });
  return Array.from(currencies).sort();
}
