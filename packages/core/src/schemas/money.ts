import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { Currency } from '../types/currency.ts';

// Custom Zod type for Decimal.js instances
export const DecimalSchema = z.instanceof(Decimal, {
  message: 'Expected Decimal instance',
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
