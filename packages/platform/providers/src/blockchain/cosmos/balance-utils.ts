/**
 * Pure functions for Cosmos balance operations
 *
 * These functions handle balance extraction, filtering, and conversion
 * for Cosmos SDK-based chains.
 */
import { parseDecimal } from '@exitbook/core';

import type { InjectiveBalance } from './providers/injective-explorer/injective-explorer.schemas.js';

/**
 * Result of balance conversion
 */
export interface BalanceConversionResult {
  rawAmount: string;
  decimalAmount: string;
  decimals: number;
  symbol: string;
}

/**
 * Find native token balance from array of balances
 *
 * Searches for the native token by matching the denom against expected values.
 *
 * @param balances - Array of balance objects
 * @param nativeDenom - Native denomination to search for (e.g., "inj", "INJ")
 * @returns Native balance object, or undefined if not found
 *
 * @example
 * ```typescript
 * const balances = [
 *   { denom: "inj", amount: "1000000" },
 *   { denom: "usdc", amount: "5000000" }
 * ];
 * findNativeBalance(balances, "INJ") // { denom: "inj", amount: "1000000" }
 * ```
 */
export function findNativeBalance(balances: InjectiveBalance[], nativeDenom: string): InjectiveBalance | undefined {
  return balances.find((balance) => balance.denom === nativeDenom.toLowerCase() || balance.denom === nativeDenom);
}

/**
 * Convert balance from smallest unit to main unit
 *
 * @param balanceSmallest - Balance in smallest unit (e.g., wei, satoshi)
 * @param decimals - Number of decimals for the token
 * @param symbol - Token symbol
 * @returns Conversion result with both raw and decimal amounts
 *
 * @example
 * ```typescript
 * convertBalance("1000000000000000000", 18, "INJ")
 * // Returns { rawAmount: "1000000000000000000", decimalAmount: "1", decimals: 18, symbol: "INJ" }
 * ```
 */
export function convertBalance(balanceSmallest: string, decimals: number, symbol: string): BalanceConversionResult {
  const balanceDecimal = parseDecimal(balanceSmallest).div(parseDecimal('10').pow(decimals)).toFixed();

  return {
    rawAmount: balanceSmallest,
    decimalAmount: balanceDecimal,
    decimals,
    symbol,
  };
}

/**
 * Create zero balance result
 *
 * @param symbol - Token symbol
 * @param decimals - Number of decimals
 * @returns Zero balance result
 */
export function createZeroBalance(symbol: string, decimals: number): BalanceConversionResult {
  return {
    rawAmount: '0',
    decimalAmount: '0',
    decimals,
    symbol,
  };
}
