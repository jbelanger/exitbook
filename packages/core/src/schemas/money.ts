import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { Currency } from '../types/currency.js';
import { parseDecimal } from '../utils/decimal-utils.js';

// Decimal schema - accepts string, number, or Decimal instance, transforms to Decimal
// Used for parsing from DB (strings), API responses (numbers with scientific notation), or validating in-memory objects (Decimal instances)
export const DecimalSchema = z.union([z.string(), z.number(), z.instanceof(Decimal)]).transform((val) => {
  if (val instanceof Decimal) return val;
  return parseDecimal(val);
});

// Decimal string schema - accepts string, number, or Decimal instance, transforms to fixed-point string (no scientific notation)
// Used for API validation and storage where string representation is required
export const DecimalStringSchema = z
  .union([z.string(), z.number(), z.instanceof(Decimal)])
  .refine(
    (val) => {
      if (val instanceof Decimal) return true;
      if (val === '') return false;
      return parseDecimal(val) !== undefined;
    },
    {
      message: 'Must be a valid numeric string or number',
    }
  )
  .transform((val) => {
    if (val instanceof Decimal) return val.toFixed();
    return parseDecimal(val).toFixed();
  });

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

// Currency schema - transforms string to Currency instance
export const CurrencySchema = z
  .string()
  .min(1, 'Currency must not be empty')
  .transform((val) => Currency.create(val))
  .or(z.custom<Currency>((val) => val instanceof Currency, { message: 'Expected Currency instance' }));

// Money schema for consistent amount and currency structure
export const MoneySchema = z.object({
  amount: DecimalSchema,
  currency: CurrencySchema,
});

export type Money = z.infer<typeof MoneySchema>;
