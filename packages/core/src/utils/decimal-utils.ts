import { Decimal } from 'decimal.js';

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
 * Try to parse a string, number, or Decimal to a Decimal
 * Handles scientific notation from JavaScript numbers (e.g., 1e-8 -> 0.00000001)
 */
export function tryParseDecimal(
  value: string | number | Decimal | undefined | null,
  out?: { value: Decimal }
): boolean {
  if (value === undefined || value === null || value === '') {
    if (out) out.value = new Decimal('0');
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
 * Parse a string, number, or Decimal to a Decimal with fallback to zero
 * Handles scientific notation from JavaScript numbers (e.g., 1e-8 -> 0.00000001)
 */
export function parseDecimal(value: string | number | Decimal | undefined | null): Decimal {
  const result = { value: new Decimal('0') };
  tryParseDecimal(value, result);
  return result.value;
}
