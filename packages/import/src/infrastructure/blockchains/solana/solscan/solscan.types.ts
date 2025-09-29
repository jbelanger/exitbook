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

// Solscan provider-specific types
export interface SolscanResponse<T = unknown> {
  data?: T;
  message?: string;
  success: boolean;
}
