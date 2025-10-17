/**
 * Blockchain balance snapshot
 */
export interface BlockchainBalanceSnapshot {
  balances: Record<string, string>; // currency → balance as decimal string
}
