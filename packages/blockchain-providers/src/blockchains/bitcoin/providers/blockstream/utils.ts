import { satoshisToBtcString } from '../../utils.js';

import type { BlockstreamAddressInfo } from './blockstream.schemas.js';

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
    balanceBTC: satoshisToBtcString(totalBalanceSats),
    hasTransactions: txCount > 0,
    totalBalanceSats,
    txCount,
  };
}
