import type { Decimal } from 'decimal.js';

/**
 * Solana token balance information
 */
export interface SolanaTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount?: number;
    uiAmountString: string;
  };
}

/**
 * Solana transaction processing result
 */
export interface ProcessedSolanaTransaction {
  amount: Decimal;
  blockTime: number;
  fee: number;
  from?: string;
  hash: string;
  instructions: {
    data?: unknown;
    program: string;
    type: string;
  }[];
  program: string;
  slot: number;
  status: 'success' | 'failed';
  to?: string;
  type: 'transfer_in' | 'transfer_out' | 'swap' | 'stake' | 'unstake' | 'other';
}

// Solana RPC API response types for Helius provider
export interface SolanaSignature {
  blockTime?: number;
  err?: unknown;
  memo?: string;
  signature: string;
  slot: number;
}

export interface SolanaAccountBalance {
  value: number;
}

export interface SolanaTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount?: number;
            uiAmountString: string;
          };
        };
        type: string;
      };
      program: string;
      space: number;
    };
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
  };
  pubkey: string;
}

export interface SolanaTokenAccountsResponse {
  value: SolanaTokenAccount[];
}
