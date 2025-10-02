import { z } from 'zod';

/**
 * Zod schema utilities for common blockchain data transformations
 */

/**
 * Schema that accepts hex strings (0x...), numeric strings, or numbers
 * and transforms them to numeric decimal strings.
 *
 * Examples:
 * - "0x12" -> "18"
 * - "18" -> "18"
 * - 18 -> "18"
 * - null -> null
 *
 * This is useful for blockchain APIs that return numeric values in different formats.
 */
export const hexOrNumericToNumeric = z
  .union([
    z.string().regex(/^0x[\da-fA-F]+$/, 'Must be hex string'),
    z.string().regex(/^\d+$/, 'Must be numeric string'),
    z.number().nonnegative(),
    z.null(),
  ])
  .transform((val) => {
    if (val === null || val === undefined) return;
    if (typeof val === 'number') return String(val);
    if (val.startsWith('0x')) {
      return BigInt(val).toString(); // Convert hex to decimal string
    }
    return val; // Already numeric string
  })
  .optional();

/**
 * Schema that accepts hex strings (0x...), numeric strings, or numbers (required version)
 * and transforms them to numeric decimal strings.
 *
 * Examples:
 * - "0x12" -> "18"
 * - "18" -> "18"
 * - 18 -> "18"
 *
 * Use this when the field is required (not optional).
 */
export const hexOrNumericToNumericRequired = z
  .union([
    z.string().regex(/^0x[\da-fA-F]+$/, 'Must be hex string'),
    z.string().regex(/^\d+$/, 'Must be numeric string'),
    z.number().nonnegative(),
  ])
  .transform((val) => {
    if (typeof val === 'number') return String(val);
    if (val.startsWith('0x')) {
      return BigInt(val).toString(); // Convert hex to decimal string
    }
    return val; // Already numeric string
  });
