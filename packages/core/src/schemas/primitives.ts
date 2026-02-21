import { z } from 'zod';

/**
 * Schema for integer fields that may be returned as numbers or strings.
 * Accepts both formats and converts to numeric string.
 */
export const IntegerStringSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/, 'Must be a non-negative integer string')])
  .transform((val) => (typeof val === 'number' ? String(val) : val));

// Date schema - accepts Unix timestamp (number), ISO 8601 string, or Date instance, transforms to Date
// Used for parsing from DB (timestamps/strings) or validating in-memory objects (Date instances)
export const DateSchema = z
  .union([
    z.number().int().positive(),
    z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date string' }),
    z.date(),
  ])
  .transform((val) => {
    if (typeof val === 'number') {
      return new Date(val);
    }
    if (typeof val === 'string') {
      return new Date(val);
    }
    return val;
  });
