import { Decimal } from 'decimal.js';

/**
 * Solana transaction from Solscan API
 */
export interface SolscanTransaction {
  txHash: string;
  blockTime: number;
  slot: number;
  fee: number;
  status: 'Success' | 'Fail';
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
    postTokenBalances: unknown[];
    preBalances: number[];
    preTokenBalances: unknown[];
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
  status: 'success' | 'failed';
  type: 'transfer_in' | 'transfer_out' | 'swap' | 'stake' | 'unstake' | 'other';
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