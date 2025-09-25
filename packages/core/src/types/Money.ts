/**
 * Money Value Object for ProcessedTransaction + Purpose Classifier
 *
 * Uses DecimalString for JSON serialization and high-precision financial calculations.
 * Amounts are always positive; direction is handled at the movement level.
 */

import type { Result } from 'neverthrow';
import type { ZodError } from 'zod';

import { MoneySchema2 } from '../schemas/processed-transaction-schemas.js';
import { fromZod } from '../utils/zod-utils.js';

import type { DecimalString, Currency } from './primitives.js';

/**
 * Money value object for financial calculations
 *
 * Requirements:
 * - Amount stored as DecimalString for JSON serialization
 * - Must be parsed to Decimal at computation boundaries
 * - Supports up to 18 decimal places for crypto precision
 * - Amount is always positive (negative handled by direction)
 */
export interface Money2 {
  readonly amount: DecimalString; // Always positive, max 18 decimal places
  readonly currency: Currency; // Currency identifier
}

/**
 * Create Money value object with validation using Zod schema
 */
export function createMoney(amount: DecimalString, currency: Currency): Result<Money2, ZodError> {
  const money: Money2 = {
    amount: amount.trim(),
    currency: currency.trim().toUpperCase(),
  };

  return fromZod(MoneySchema2, money);
}
