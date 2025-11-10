import { parseDecimal } from '@exitbook/core';

import type { RawBalanceData } from '../../core/types/index.js';

/**
 * Converts balance from smallest unit (planck/rao) to main unit (DOT/TAO/KSM)
 *
 * @param balanceSmallest - Balance in smallest unit as string
 * @param decimals - Number of decimals for the currency
 * @returns Balance in main unit as string (using toFixed() to avoid scientific notation)
 */
export function convertToMainUnit(balanceSmallest: string, decimals: number): string {
  return parseDecimal(balanceSmallest).div(parseDecimal('10').pow(decimals)).toFixed();
}

/**
 * Creates a RawBalanceData object with proper structure
 *
 * @param rawAmount - Balance in smallest unit
 * @param decimalAmount - Balance in main unit
 * @param decimals - Number of decimals
 * @param symbol - Currency symbol (e.g., DOT, TAO, KSM)
 * @returns Structured balance data object
 */
export function createRawBalanceData(
  rawAmount: string,
  decimalAmount: string,
  decimals: number,
  symbol: string
): RawBalanceData {
  return {
    rawAmount,
    decimalAmount,
    decimals,
    symbol,
  };
}
