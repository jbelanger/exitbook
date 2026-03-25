// Re-export types from schemas (single source of truth)
export type { SolanaTokenAccount, SolanaTokenBalance } from './schemas.js';

// Import for local use
import type { SolanaTokenAccount } from './schemas.js';

/**
 * Solana RPC API response wrapper for token accounts
 */
export interface SolanaTokenAccountsResponse {
  value: SolanaTokenAccount[];
}
