import type { SolanaTokenBalance } from '../types.ts';

// Helius provider-specific types
export interface HeliusTransaction {
  blockTime?: number;
  err: unknown;
  meta: {
    err: unknown;
    fee: number;
    logMessages: string[];
    postBalances: number[];
    postTokenBalances?: SolanaTokenBalance[];
    preBalances: number[];
    preTokenBalances?: SolanaTokenBalance[];
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
      description?: string;
      name?: string;
      symbol?: string;
    };
  };
}

export interface HeliusSignatureResponse {
  blockTime?: number;
  err: unknown;
  memo: string;
  signature: string;
  slot: number;
}
