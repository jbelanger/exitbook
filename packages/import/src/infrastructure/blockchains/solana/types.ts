import type { Decimal } from 'decimal.js';

/**
 * Solana transaction from Solscan API
 */
export interface SolscanTransaction {
  blockTime: number;
  fee: number;
  inputAccount: {
    account: string;
    postBalance: number;
    preBalance: number;
    signer: boolean;
    writable: boolean;
  }[];
  lamport: number;
  logMessage: string[];
  parsedInstruction: {
    params?: Record<string, unknown>;
    program: string;
    programId: string;
    type: string;
  }[];
  recentBlockhash: string;
  signer: string[];
  slot: number;
  status: 'Success' | 'Fail';
  txHash: string;
}

/**
 * Solana account balance from Solscan API
 */
export interface SolscanBalance {
  account: string;
  executable: boolean;
  lamports: number;
  ownerProgram: string;
  rentEpoch: number;
  type: string;
}

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

// Solscan provider-specific types
export interface SolscanResponse<T = unknown> {
  data?: T;
  message?: string;
  success: boolean;
}
