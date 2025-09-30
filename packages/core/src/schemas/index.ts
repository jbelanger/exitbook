import { Decimal } from 'decimal.js';
import { z } from 'zod';

// Custom Zod type for Decimal.js instances
const DecimalSchema = z.instanceof(Decimal, {
  message: 'Expected Decimal instance',
});

// Money schema for consistent amount and currency structure
export const MoneySchema = z.object({
  amount: DecimalSchema,
  currency: z.string().min(1, 'Currency must not be empty'),
});
