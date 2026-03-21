import { parseDecimal } from '@exitbook/core';
import { z } from 'zod';

/**
 * Zod schema utilities for common blockchain data transformations
 */

/**
 * Schema that accepts hex strings (0x...), numeric strings, or numbers
 * and transforms them to numeric decimal strings without scientific notation.
 *
 * Examples:
 * - "0x12" -> "18"
 * - "18" -> "18"
 * - 18 -> "18"
 * - null -> null
 *
 * This is useful for blockchain APIs that return numeric values in different formats.
 * Uses Decimal.js for conversion to maintain precision for any decimal values.
 * Uses toFixed() to avoid scientific notation (e.g., "1e-8" becomes "0.00000001").
 */
export const hexOrNumericToNumericOptional = z
  .union([
    z.string().regex(/^0x[\da-fA-F]+$/, 'Must be hex string'),
    z.string().regex(/^\d+$/, 'Must be numeric string'),
    z.number().nonnegative(),
    z.null(),
  ])
  .transform((val) => {
    if (val === null || val === undefined) return;
    return parseDecimal(val.toString()).toFixed();
  })
  .optional();

/**
 * Schema that accepts hex strings (0x...), numeric strings, or numbers (required version)
 * and transforms them to numeric decimal strings without scientific notation.
 *
 * Examples:
 * - "0x12" -> "18"
 * - "18" -> "18"
 * - 18 -> "18"
 *
 * Use this when the field is required (not optional).
 * Uses Decimal.js for conversion to maintain precision for any decimal values.
 * Uses toFixed() to avoid scientific notation (e.g., "1e-8" becomes "0.00000001").
 */
export const hexOrNumericToNumericRequired = z
  .union([
    z.string().regex(/^0x[\da-fA-F]+$/, 'Must be hex string'),
    z.string().regex(/^\d+$/, 'Must be numeric string'),
    z.number().nonnegative(),
  ])
  .transform((val) => {
    return parseDecimal(val.toString()).toFixed();
  });

/**
 * Parses boolean values from API responses that may return boolean, string ("true"/"false"),
 * or numeric string ("0"/"1") formats. Returns undefined for invalid or missing values.
 *
 * Examples:
 * - true -> true
 * - false -> false
 * - "true" / "True" / "TRUE" -> true
 * - "false" / "False" / "FALSE" -> false
 * - "1" -> true
 * - "0" -> false
 * - null -> undefined
 * - undefined -> undefined
 * - "invalid" -> undefined
 *
 * This is useful for blockchain APIs that return boolean flags in inconsistent formats.
 * Case-insensitive to handle providers that may send "True"/"False" instead of "true"/"false".
 */
export function parseApiBoolean(value: boolean | string | undefined | null): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;

  // Normalize string to lowercase for case-insensitive comparison
  const normalizedValue = value.toLowerCase();
  if (normalizedValue === 'true' || normalizedValue === '1') return true;
  if (normalizedValue === 'false' || normalizedValue === '0') return false;
  return undefined;
}

/**
 * Schema that accepts various timestamp formats and transforms them to a Date object.
 *
 * Examples:
 * - 1609459200 -> Date (Unix timestamp in seconds)
 * - 1609459200000 -> Date (Unix timestamp in milliseconds)
 * - "1609459200" -> Date (Unix timestamp string)
 * - "2021-01-01T00:00:00.000Z" -> Date (ISO 8601 string)
 * - "2021-01-01 00:00:00.000 +0000 UTC" -> Date (UTC string format)
 * - Date object -> Date (returned as-is)
 *
 * This is useful for blockchain APIs that return timestamps in different formats.
 */
export const timestampToDate = z.union([z.number().nonnegative(), z.string(), z.date()]).transform((val) => {
  // Date object: Return as-is
  if (val instanceof Date) {
    return val;
  }

  // Number: Unix timestamp
  if (typeof val === 'number') {
    const isMilliseconds = val > 10000000000;
    const milliseconds = isMilliseconds ? val : val * 1000;
    return new Date(milliseconds);
  }

  // String: Could be numeric timestamp, ISO 8601, or other date format
  // Try numeric first
  if (/^\d+$/.test(val)) {
    const timestamp = parseInt(val, 10);
    const isMilliseconds = timestamp > 10000000000;
    const milliseconds = isMilliseconds ? timestamp : timestamp * 1000;
    return new Date(milliseconds);
  }

  // Let Date constructor handle all other string formats
  const date = new Date(val);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp format: ${val}`);
  }
  return date;
});
