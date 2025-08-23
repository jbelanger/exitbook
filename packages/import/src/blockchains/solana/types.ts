import { Decimal } from "decimal.js";

/**
 * Solana transaction from Solscan API
 */
export interface SolscanTransaction {
  txHash: string;
  blockTime: number;
  slot: number;
  fee: number;
  status: "Success" | "Fail";
  lamport: number;
  signer: string[];
  logMessage: string[];
  inputAccount: Array<{
    account: string;
    signer: boolean;
    writable: boolean;
    preBalance: number;
    postBalance: number;
  }>;
  recentBlockhash: string;
  parsedInstruction: Array<{
    program: string;
    programId: string;
    type: string;
    params?: Record<string, unknown>;
  }>;
}

/**
 * Solana account balance from Solscan API
 */
export interface SolscanBalance {
  account: string;
  lamports: number;
  ownerProgram: string;
  type: string;
  rentEpoch: number;
  executable: boolean;
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
  slot: number;
  transaction: {
    message: {
      accountKeys: string[];
      header: {
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
        numRequiredSignatures: number;
      };
      instructions: Array<{
        accounts: number[];
        data: string;
        programIdIndex: number;
      }>;
      recentBlockhash: string;
    };
    signatures: string[];
  };
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
    status: { Ok: null } | { Err: unknown };
  };
  blockTime: number;
}


/**
 * Solana transaction processing result
 */
export interface ProcessedSolanaTransaction {
  hash: string;
  slot: number;
  blockTime: number;
  fee: number;
  status: "success" | "failed";
  type: "transfer_in" | "transfer_out" | "swap" | "stake" | "unstake" | "other";
  amount: Decimal;
  from?: string;
  to?: string;
  program: string;
  instructions: Array<{
    program: string;
    type: string;
    data?: unknown;
  }>;
}

// Solana RPC API response types for Helius provider
export interface SolanaSignature {
  signature: string;
  slot: number;
  err?: unknown;
  memo?: string;
  blockTime?: number;
}

export interface SolanaAccountBalance {
  value: number;
}

export interface SolanaTokenAccount {
  pubkey: string;
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
}

export interface SolanaTokenAccountsResponse {
  value: SolanaTokenAccount[];
}

// Helius provider-specific types
export interface HeliusTransaction {
  signature: string;
  slot: number;
  blockTime?: number;
  err: unknown;
  meta: {
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: SolanaTokenBalance[];
    postTokenBalances?: SolanaTokenBalance[];
    logMessages: string[];
    err: unknown;
  };
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
      symbol?: string;
      name?: string;
      description?: string;
    };
  };
}

export interface HeliusSignatureResponse {
  signature: string;
  slot: number;
  err: unknown;
  memo: string;
  blockTime?: number;
}

// Solscan provider-specific types
export interface SolscanResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}
