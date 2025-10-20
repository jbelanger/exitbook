/**
 * Blockchain balance snapshot
 */
export interface BlockchainBalanceSnapshot {
  total: string; // total balance as decimal string
  asset: string; // native currency symbol (e.g., "BTC", "ETH", "SOL") or token identifier (e.g., contract address or token ID)
}
