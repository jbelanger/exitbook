/**
 * Blockchain balance snapshot
 */
export interface BlockchainBalanceSnapshot {
  total: string; // total balance as decimal string
}

export interface BlockchainTokenBalanceSnapshot {
  token: string; // token identifier (e.g., contract address or token ID)
  total: string; // total balance as decimal string
}
