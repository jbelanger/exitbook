import { wrapError } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

/**
 * Normalize token amount from smallest units to human-readable decimal units.
 *
 * Convention: ALL blockchain providers must return amounts in smallest units (wei, satoshi, etc.).
 * This function always divides by 10^decimals to convert to human-readable format.
 *
 * @param amount - The token amount in smallest units
 * @param decimals - The token decimals (e.g., 6 for USDC, 18 for most ERC-20 tokens)
 * @returns Result containing normalized amount in human-readable decimal units, or Error if normalization fails
 *
 * @example
 * // USDC (6 decimals): 1000000000 smallest units → 1000 USDC
 * normalizeTokenAmount('1000000000', 6) // ok('1000')
 *
 * // DAI (18 decimals): 5000000000000000000000 smallest units → 5000 DAI
 * normalizeTokenAmount('5000000000000000000000', 18) // ok('5000')
 *
 * // No decimals metadata: return as-is
 * normalizeTokenAmount('123.45', undefined) // ok('123.45')
 */
export function normalizeTokenAmount(amount: string | undefined, decimals?: number): Result<string, Error> {
  if (!amount || amount === '0') {
    return ok('0');
  }

  // If no decimals metadata, return amount as-is
  if (decimals === undefined || decimals === null) {
    return ok(amount);
  }

  try {
    const result = new Decimal(amount).dividedBy(new Decimal('10').pow(decimals));
    // Use toFixed() to prevent scientific notation, then remove trailing zeros
    return ok(result.toFixed(decimals).replace(/\.?0+$/, ''));
  } catch (error) {
    return wrapError(error, `Unable to normalize token amount: ${amount}`);
  }
}

/**
 * Normalize native currency amount from smallest units (wei, satoshi, etc.) to human-readable decimal units.
 *
 * Unlike token amounts, native amounts are more consistently returned in smallest units by providers.
 *
 * @param amount - The native currency amount in smallest units (e.g., wei for ETH, satoshi for BTC)
 * @param decimals - The native currency decimals (e.g., 18 for ETH, 8 for BTC)
 * @returns Result containing normalized amount in human-readable decimal units, or Error if normalization fails
 *
 * @example
 * // ETH: 1000000000000000000 wei with 18 decimals → 1 ETH
 * normalizeNativeAmount('1000000000000000000', 18) // ok('1')
 *
 * // BTC: 100000000 satoshi with 8 decimals → 1 BTC
 * normalizeNativeAmount('100000000', 8) // ok('1')
 */
export function normalizeNativeAmount(amount: string | undefined, decimals: number): Result<string, Error> {
  if (!amount || amount === '0') {
    return ok('0');
  }

  try {
    const result = new Decimal(amount).dividedBy(new Decimal('10').pow(decimals));
    // Use toFixed() to prevent scientific notation, then remove trailing zeros
    return ok(result.toFixed(decimals).replace(/\.?0+$/, ''));
  } catch (error) {
    return wrapError(error, `Unable to normalize native amount: ${amount}`);
  }
}
