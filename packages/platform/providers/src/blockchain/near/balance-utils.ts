import { parseDecimal } from '@exitbook/core';

import type { RawBalanceData } from '../../shared/blockchain/types/index.js';

/**
 * Convert yoctoNEAR to NEAR decimal string
 * 1 NEAR = 10^24 yoctoNEAR
 */
export function convertYoctoNearToNear(yoctoNear: number | string): string {
  return parseDecimal(yoctoNear.toString()).div(parseDecimal('10').pow(24)).toFixed();
}

/**
 * Transform NEAR balance from yoctoNEAR to RawBalanceData format
 */
export function transformNearBalance(yoctoNear: number | string): RawBalanceData {
  const yoctoNearStr = parseDecimal(yoctoNear.toString()).toFixed();
  const balanceNear = convertYoctoNearToNear(yoctoNearStr);

  return {
    decimals: 24,
    decimalAmount: balanceNear,
    rawAmount: yoctoNearStr,
    symbol: 'NEAR',
  };
}

/**
 * Transform token balance to RawBalanceData format
 */
export function transformTokenBalance(
  contractAddress: string,
  decimals: number,
  rawAmount: string,
  decimalAmount: string,
  symbol?: string
): RawBalanceData {
  return {
    contractAddress,
    decimalAmount,
    decimals,
    rawAmount,
    symbol,
  };
}
