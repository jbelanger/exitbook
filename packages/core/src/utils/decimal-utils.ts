import { Decimal } from 'decimal.js';

import type { Money } from '../value-objects/money.ts';

// Configure Decimal.js for cryptocurrency precision
// Most cryptocurrencies use up to 18 decimal places, so we set precision high
Decimal.set({
  maxE: 9e15, // Maximum exponent
  minE: -9e15, // Minimum exponent
  modulo: Decimal.ROUND_HALF_UP,
  precision: 28, // High precision for crypto calculations
  rounding: Decimal.ROUND_HALF_UP, // Standard rounding
  toExpNeg: -7, // Use exponential notation for numbers smaller than 1e-7
  toExpPos: 21, // Use exponential notation for numbers larger than 1e+21
});

/**
 * Try to parse a string or number to a Decimal
 */
export function tryParseDecimal(value: string | Decimal | undefined | null, out?: { value: Decimal }): boolean {
  if (value === undefined || value === null || value === '') {
    if (out) out.value = new Decimal(0);
    return true;
  }

  try {
    const decimal = new Decimal(value);
    if (out) out.value = decimal;
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a string or number to a Decimal with fallback to zero
 */
export function parseDecimal(value: string | Decimal | undefined | null): Decimal {
  const result = { value: new Decimal(0) };
  tryParseDecimal(value, result);
  return result.value;
}

/**
 * Create a Money object with proper decimal parsing
 */
export function createMoney(amount: string | Decimal | undefined | null, currency: string): Money {
  return {
    amount: parseDecimal(amount),
    currency: currency || 'unknown',
  };
}

/**
 * Check if a Decimal value can be safely converted to number without precision loss
 */
export function canSafelyConvertToNumber(decimal: Decimal): boolean {
  // Check if value exceeds JavaScript's safe integer range
  if (decimal.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    return false;
  }

  // Check if conversion would lose precision by comparing string representations
  const asNumber = decimal.toNumber();
  const backToDecimal = new Decimal(asNumber);
  return decimal.equals(backToDecimal);
}

/**
 * Safely convert Decimal to number with precision validation
 */
export function safeDecimalToNumber(
  decimal: Decimal,
  options?: {
    allowPrecisionLoss?: boolean | undefined;
    warningCallback?: (message: string) => void | undefined;
  }
): number {
  const { allowPrecisionLoss = false, warningCallback } = options || {};

  if (!canSafelyConvertToNumber(decimal)) {
    const message = `Precision loss detected converting Decimal to number: ${decimal.toString()} -> ${decimal.toNumber()}`;

    if (warningCallback) {
      warningCallback(message);
    }

    if (!allowPrecisionLoss) {
      throw new Error(message);
    }
  }

  return decimal.toNumber();
}

/**
 * Convert Money to a number for legacy compatibility (use with caution)
 */
export function moneyToNumber(money: Money | number | undefined): number {
  if (typeof money === 'number') {
    return money;
  }

  if (!money) {
    return 0;
  }

  return money.amount.toNumber();
}

/**
 * Convert Decimal to string with appropriate precision for display
 */
export function formatDecimal(decimal: Decimal, maxDecimalPlaces = 8): string {
  return decimal.toFixed(maxDecimalPlaces).replace(/\.?0+$/, '');
}

/**
 * Safe addition of Money objects (same currency)
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add different currencies: ${a.currency} and ${b.currency}`);
  }

  return {
    amount: a.amount.plus(b.amount),
    currency: a.currency,
  };
}

/**
 * Safe subtraction of Money objects (same currency)
 */
export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot subtract different currencies: ${a.currency} and ${b.currency}`);
  }

  return {
    amount: a.amount.minus(b.amount),
    currency: a.currency,
  };
}

/**
 * Compare Money objects for equality
 */
export function moneyEquals(a: Money | undefined, b: Money | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return a.currency === b.currency && a.amount.equals(b.amount);
}

/**
 * Check if Money amount is zero
 */
export function isZeroMoney(money: Money | undefined): boolean {
  return !money || money.amount.isZero();
}

/**
 * Convert Decimal to string for database storage (preserves full precision)
 */
export function decimalToString(decimal: Decimal | undefined): string | undefined {
  if (!decimal) return undefined;
  return decimal.toString();
}

/**
 * Convert string from database back to Decimal
 */
export function stringToDecimal(value: string | undefined): Decimal {
  if (!value) return new Decimal(0);
  return parseDecimal(value);
}

/**
 * Convert Money object to database-compatible object with string amounts
 */
export function moneyToDbString(money: Money | undefined): string | undefined {
  if (!money) return undefined;
  return money.amount.toString();
}

/**
 * Convert database string back to Money object
 */
export function dbStringToMoney(amount: string | null, currency: string | null): Money | undefined {
  if (!amount || !currency) return undefined;
  return {
    amount: stringToDecimal(amount),
    currency,
  };
}
