import type { Decimal } from 'decimal.js';

import type { Currency } from './currency.ts';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: Currency;
}
