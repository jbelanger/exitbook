import { Decimal } from 'decimal.js';
import { z } from 'zod';

import { Currency } from '../value-objects/currency.js';

// Custom Zod type for Decimal.js instances
export const DecimalSchema = z.instanceof(Decimal, {
  message: 'Expected Decimal instance',
});

// Currency schema - transforms string to Currency instance
export const CurrencySchema = z
  .union([z.string().min(1, 'Currency must not be empty'), z.instanceof(Currency)])
  .transform((val) => {
    if (val instanceof Currency) {
      return val;
    }
    return Currency.create(val);
  });

// Money schema for consistent amount and currency structure
export const MoneySchema = z.object({
  amount: DecimalSchema,
  currency: CurrencySchema,
});
