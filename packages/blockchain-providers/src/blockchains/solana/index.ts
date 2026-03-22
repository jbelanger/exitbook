/**
 * Solana blockchain provider exports
 */

export type { SolanaChainConfig } from './chain-config.interface.js';
export { SOLANA_CHAINS, getSolanaChainConfig } from './chain-registry.js';
export { SolanaTransactionSchema } from './schemas.js';
export type { SolanaTransaction } from './schemas.js';
export {
  deduplicateTransactionsBySignature,
  extractAccountChanges,
  extractAccountChangesFromSolscan,
  extractTokenChanges,
  generateSolanaTransactionEventId,
  isValidSolanaAddress,
  lamportsToSol,
  parseSolanaTransactionType,
  solToLamports,
} from './utils.js';
