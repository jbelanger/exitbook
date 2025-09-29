import type { SolanaTokenAccountsResponse, SolanaTokenBalance } from '../types.js';

/**
 * Solana RPC transaction response
 */
export interface SolanaRPCTransaction {
  blockTime: number;
  meta: {
    err: unknown;
    fee: number;
    innerInstructions: unknown[];
    logMessages: string[];
    postBalances: number[];
    postTokenBalances: SolanaTokenBalance[];
    preBalances: number[];
    preTokenBalances: SolanaTokenBalance[];
    rewards: unknown[];
    status: { Ok: undefined } | { Err: unknown };
  };
  slot: number;
  transaction: {
    message: {
      accountKeys: string[];
      header: {
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
        numRequiredSignatures: number;
      };
      instructions: {
        accounts: number[];
        data: string;
        programIdIndex: number;
      }[];
      recentBlockhash: string;
    };
    signatures: string[];
  };
}

export interface SolanaRPCRawTransactionData {
  normal: SolanaRPCTransaction[];
}

export interface SolanaRPCRawBalanceData {
  lamports: number;
}

export interface SolanaRPCRawTokenBalanceData {
  tokenAccounts: SolanaTokenAccountsResponse;
}
