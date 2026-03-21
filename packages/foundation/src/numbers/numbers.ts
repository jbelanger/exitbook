import { z } from 'zod';

/**
 * Schema for integer fields that may be returned as numbers or strings.
 * Accepts both formats and converts to numeric string.
 */
export const IntegerStringSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/, 'Must be a non-negative integer string')])
  .transform((val) => (typeof val === 'number' ? String(val) : val));
