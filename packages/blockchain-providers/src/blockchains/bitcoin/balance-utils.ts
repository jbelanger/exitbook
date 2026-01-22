import type { RawBalanceData } from '../../core/types/index.js';

/**
 * Shared Bitcoin balance utilities
 * Provider-specific balance calculation logic lives in each provider's utils.ts file
 */

/**
 * Create RawBalanceData from calculated balance values
 *
 * @param balanceSats - Balance in satoshis (smallest unit)
 * @param balanceBTC - Balance in BTC (decimal format)
 * @param nativeCurrency - Currency symbol (e.g., 'BTC', 'DOGE', 'LTC', 'BCH')
 */
export function createRawBalanceData(balanceSats: number, balanceBTC: string, nativeCurrency: string): RawBalanceData {
  return {
    decimalAmount: balanceBTC,
    decimals: 8,
    rawAmount: balanceSats.toString(),
    symbol: nativeCurrency,
  };
}
