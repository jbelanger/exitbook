import type { RawBalanceData } from '../../shared/blockchain/types/index.js';

/**
 * Pure functions for Cardano balance calculations
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Convert lovelace (smallest unit) to ADA
 * 1 ADA = 1,000,000 lovelace
 */
export function lovelaceToAda(lovelace: string | number): string {
  const lovelaceNum = typeof lovelace === 'string' ? parseFloat(lovelace) : lovelace;
  return (lovelaceNum / 1000000).toString();
}

/**
 * Create RawBalanceData from lovelace balance
 */
export function createRawBalanceData(lovelace: string, ada: string): RawBalanceData {
  return {
    decimals: 6,
    decimalAmount: ada,
    rawAmount: lovelace,
    symbol: 'ADA',
  };
}
