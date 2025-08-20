import { Money } from '@crypto/core';
import { Decimal } from 'decimal.js';

// Configure Decimal.js for cryptocurrency precision
// Most cryptocurrencies use up to 18 decimal places, so we set precision high
Decimal.set({
  precision: 28,  // High precision for crypto calculations
  rounding: Decimal.ROUND_HALF_UP,  // Standard rounding
  toExpNeg: -7,   // Use exponential notation for numbers smaller than 1e-7
  toExpPos: 21,   // Use exponential notation for numbers larger than 1e+21
  maxE: 9e15,     // Maximum exponent
  minE: -9e15,    // Minimum exponent
  modulo: Decimal.ROUND_HALF_UP
});

/**
 * Parse a string or number to a Decimal with proper error handling
 */
export function parseDecimal(value: string | number | undefined | null): Decimal {
  if (value === undefined || value === null || value === '') {
    return new Decimal(0);
  }

  try {
    return new Decimal(value);
  } catch (error) {
    console.warn(`Failed to parse decimal value: ${value}`, error);
    return new Decimal(0);
  }
}

/**
 * Create a Money object with proper decimal parsing
 */
export function createMoney(amount: string | number | undefined | null, currency: string): Money {
  return {
    amount: parseDecimal(amount),
    currency: currency || 'unknown'
  };
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
export function formatDecimal(decimal: Decimal, maxDecimalPlaces: number = 8): string {
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
    currency: a.currency
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
    currency: a.currency
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
export function decimalToString(decimal: Decimal | undefined | null): string | null {
  if (!decimal) return null;
  return decimal.toString();
}

/**
 * Convert string from database back to Decimal
 */
export function stringToDecimal(value: string | null | undefined): Decimal {
  if (!value) return new Decimal(0);
  return parseDecimal(value);
}

/**
 * Convert Money object to database-compatible object with string amounts
 */
export function moneyToDbString(money: Money | undefined): string | null {
  if (!money) return null;
  return money.amount.toString();
}

/**
 * Convert database string back to Money object
 */
export function dbStringToMoney(amount: string | null, currency: string | null): Money | undefined {
  if (!amount || !currency) return undefined;
  return {
    amount: stringToDecimal(amount),
    currency
  };
}