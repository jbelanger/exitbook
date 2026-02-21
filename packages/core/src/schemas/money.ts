import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { Currency } from '../currency.js';
import { parseDecimal, tryParseDecimal } from '../utils/decimal-utils.js';

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
      return tryParseDecimal(val);
    },
    {
      message: 'Must be a valid numeric string or number',
    }
  )
  .transform((val) => {
    if (val instanceof Decimal) return val.toFixed();
    return parseDecimal(val).toFixed();
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
