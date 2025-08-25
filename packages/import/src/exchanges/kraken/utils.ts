/**
 * Validation utilities for Kraken CSV data formats
 *
 * These utilities provide validation functions for Kraken CSV data using
 * the schemas defined in schemas.ts.
 */
import type { z } from 'zod';

import { CsvKrakenLedgerRowSchema } from './schemas.js';

/**
 * Type inference from schema for use in application code
 */
export type ValidatedCsvKrakenLedgerRow = z.infer<typeof CsvKrakenLedgerRowSchema>;

/**
 * Validation result for individual row validation
 */
export interface KrakenCsvValidationResult {
  data?: ValidatedCsvKrakenLedgerRow;
  errors?: z.ZodError;
  success: boolean;
}

/**
 * Batch validation result for multiple rows
 */
export interface KrakenCsvBatchValidationResult {
  invalid: Array<{ data: unknown; errors: z.ZodError; rowIndex: number }>;
  totalRows: number;
  valid: ValidatedCsvKrakenLedgerRow[];
}

/**
 * Validate a single Kraken CSV row
 */
export function validateKrakenCsvRow(data: unknown): KrakenCsvValidationResult {
  const result = CsvKrakenLedgerRowSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

/**
 * Validate multiple Kraken CSV rows in batch
 */
export function validateKrakenCsvRows(data: unknown[]): KrakenCsvBatchValidationResult {
  const valid: ValidatedCsvKrakenLedgerRow[] = [];
  const invalid: Array<{ data: unknown; errors: z.ZodError; rowIndex: number }> = [];

  data.forEach((item, index) => {
    const result = validateKrakenCsvRow(item);
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
export function formatKrakenValidationErrors(result: KrakenCsvBatchValidationResult): string {
  if (result.invalid.length === 0) {
    return `All ${result.totalRows} Kraken CSV rows validated successfully`;
  }

  const errorSummary = result.invalid
    .slice(0, 3) // Show first 3 errors
    .map(({ errors, rowIndex }) => {
      const fieldErrors = errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return `Row ${rowIndex + 1}: ${fieldErrors}`;
    })
    .join(' | ');

  const additionalErrors = result.invalid.length > 3 ? ` and ${result.invalid.length - 3} more` : '';

  return `${result.invalid.length} invalid Kraken CSV rows out of ${result.totalRows}. Valid: ${result.valid.length}. Errors: ${errorSummary}${additionalErrors}`;
}
