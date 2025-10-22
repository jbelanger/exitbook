import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/shared-logger';

const logger = getLogger('amount-utils');

/**
 * Normalize token amount from smallest units to human-readable decimal units.
 *
 * Convention: ALL blockchain providers must return amounts in smallest units (wei, satoshi, etc.).
 * This function always divides by 10^decimals to convert to human-readable format.
 *
 * @param amount - The token amount in smallest units
 * @param decimals - The token decimals (e.g., 6 for USDC, 18 for most ERC-20 tokens)
 * @returns Normalized amount in human-readable decimal units
 *
 * @example
 * // USDC (6 decimals): 1000000000 smallest units → 1000 USDC
 * normalizeTokenAmount('1000000000', 6) // '1000'
 *
 * // DAI (18 decimals): 5000000000000000000000 smallest units → 5000 DAI
 * normalizeTokenAmount('5000000000000000000000', 18) // '5000'
 *
 * // No decimals metadata: return as-is
 * normalizeTokenAmount('123.45', undefined) // '123.45'
 */
export function normalizeTokenAmount(amount: string | undefined, decimals?: number): string {
  if (!amount || amount === '0') {
    return '0';
  }

  // If no decimals metadata, return amount as-is
  if (decimals === undefined || decimals === null) {
    return amount;
  }

  try {
    const result = parseDecimal(amount).dividedBy(parseDecimal('10').pow(decimals));
    // Use toFixed() to prevent scientific notation, then remove trailing zeros
    return result.toFixed(decimals).replace(/\.?0+$/, '');
  } catch (error) {
    logger.warn(`Unable to normalize token amount: ${String(error)}`);
    return '0';
  }
}

/**
 * Normalize native currency amount from smallest units (wei, satoshi, etc.) to human-readable decimal units.
 *
 * Unlike token amounts, native amounts are more consistently returned in smallest units by providers.
 *
 * @param amount - The native currency amount in smallest units (e.g., wei for ETH, satoshi for BTC)
 * @param decimals - The native currency decimals (e.g., 18 for ETH, 8 for BTC)
 * @returns Normalized amount in human-readable decimal units
 *
 * @example
 * // ETH: 1000000000000000000 wei with 18 decimals → 1 ETH
 * normalizeNativeAmount('1000000000000000000', 18) // '1'
 *
 * // BTC: 100000000 satoshi with 8 decimals → 1 BTC
 * normalizeNativeAmount('100000000', 8) // '1'
 */
export function normalizeNativeAmount(amount: string | undefined, decimals: number): string {
  if (!amount || amount === '0') {
    return '0';
  }

  try {
    const result = parseDecimal(amount).dividedBy(parseDecimal('10').pow(decimals));
    // Use toFixed() to prevent scientific notation, then remove trailing zeros
    return result.toFixed(decimals).replace(/\.?0+$/, '');
  } catch (error) {
    logger.warn(`Unable to normalize native amount: ${String(error)}`);
    return '0';
  }
}
