import type { Decimal } from 'decimal.js';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: string;
}
