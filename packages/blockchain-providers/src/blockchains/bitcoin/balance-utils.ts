import { parseDecimal } from '@exitbook/core';

import type { RawBalanceData } from '../../core/types/index.js';

import type { BlockstreamAddressInfo } from './providers/blockstream/blockstream.schemas.js';
import type { MempoolAddressInfo } from './providers/mempool-space/mempool-space.schemas.js';

/**
 * Pure functions for Bitcoin balance calculations
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Convert satoshis to BTC
 */
export function satoshisToBtc(satoshis: number): string {
  return parseDecimal(satoshis.toString()).div(100000000).toFixed();
}

/**
 * Calculate Bitcoin balance from Blockstream address info
 */
export function calculateBlockstreamBalance(addressInfo: BlockstreamAddressInfo): {
  balanceBTC: string;
  hasTransactions: boolean;
  totalBalanceSats: number;
  txCount: number;
} {
  const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
  const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
  const totalBalanceSats = chainBalance + mempoolBalance;
  const txCount = addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;

  return {
    balanceBTC: satoshisToBtc(totalBalanceSats),
    hasTransactions: txCount > 0,
    totalBalanceSats,
    txCount,
  };
}

/**
 * Calculate Bitcoin balance from Mempool.space address info
 */
export function calculateMempoolSpaceBalance(addressInfo: MempoolAddressInfo): {
  balanceBTC: string;
  hasTransactions: boolean;
  totalBalanceSats: number;
  txCount: number;
} {
  const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
  const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
  const totalBalanceSats = chainBalance + mempoolBalance;
  const txCount = addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;

  return {
    balanceBTC: satoshisToBtc(totalBalanceSats),
    hasTransactions: txCount > 0,
    totalBalanceSats,
    txCount,
  };
}

/**
 * Calculate Bitcoin balance from Tatum balance data
 */
export function calculateTatumBalance(
  incomingStr: string,
  outgoingStr: string
): {
  balanceBTC: string;
  balanceSats: number;
} {
  const incomingSats = parseFloat(incomingStr);
  const outgoingSats = parseFloat(outgoingStr);
  const balanceSats = incomingSats - outgoingSats;

  return {
    balanceBTC: satoshisToBtc(balanceSats),
    balanceSats,
  };
}

/**
 * Calculate Bitcoin balance from simple final_balance (Blockchain.com and BlockCypher)
 */
export function calculateSimpleBalance(finalBalance: number): {
  balanceBTC: string;
  balanceSats: number;
} {
  return {
    balanceBTC: satoshisToBtc(finalBalance),
    balanceSats: finalBalance,
  };
}

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
