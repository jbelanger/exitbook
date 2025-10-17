import type { SolanaTokenBalance } from '../types.js';

// Helius provider-specific types
export interface HeliusTransaction {
  blockTime?: Date | number | undefined;
  err: unknown;
  meta: {
    err: unknown;
    fee: number;
    logMessages: string[];
    postBalances: number[];
    postTokenBalances?: SolanaTokenBalance[] | undefined;
    preBalances: number[];
    preTokenBalances?: SolanaTokenBalance[] | undefined;
  };
  signature: string;
  slot: number;
  transaction: {
    message: {
      accountKeys: string[];
      instructions: unknown[];
      recentBlockhash: string;
    };
    signatures: string[];
  };
}

export interface HeliusAssetResponse {
  content: {
    metadata: {
      description?: string | undefined;
      name?: string | undefined;
      symbol?: string | undefined;
    };
  };
}

export interface HeliusSignatureResponse {
  blockTime?: Date | number | undefined;
  err: unknown;
  memo: string;
  signature: string;
  slot: number;
}
