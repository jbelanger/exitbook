import type { RawBalanceData } from '../../core/types/index.js';

import { dropsToXrpDecimalString } from './utils.js';

/**
 * Transform XRP balance from drops to decimal XRP
 * 1 XRP = 1,000,000 drops (6 decimal places)
 */
export function transformXrpBalance(dropsBalance: string): RawBalanceData {
  const decimalAmount = dropsToXrpDecimalString(dropsBalance);

  return {
    contractAddress: undefined,
    decimalAmount,
    decimals: 6,
    rawAmount: dropsBalance,
    symbol: 'XRP',
  };
}

/**
 * Transform issued currency balance (token/IOU)
 * Uses issuer:currency format to uniquely identify tokens and prevent collisions
 * when an issuer has multiple currencies
 */
export function toIssuedCurrencyRawBalance(currency: string, balance: string, issuer: string): RawBalanceData {
  return {
    contractAddress: `${issuer}:${currency}`,
    decimalAmount: balance,
    rawAmount: balance,
    symbol: currency,
  };
}
