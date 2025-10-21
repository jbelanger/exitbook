import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { Currency } from '../types/currency.ts';
import { parseDecimal } from '../utils/decimal-utils.ts';

// Decimal schema - accepts string or Decimal instance, transforms to Decimal
// Used for parsing from DB (strings) or validating in-memory objects (Decimal instances)
export const DecimalSchema = z
  .string()
  .or(z.instanceof(Decimal))
  .transform((val) => (typeof val === 'string' ? parseDecimal(val) : val));

// Date schema - transforms Unix timestamp (number) to Date instance
export const DateSchema = z
  .number()
  .int()
  .positive()
  .transform((val) => new Date(val));

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
