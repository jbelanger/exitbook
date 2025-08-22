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
 * Parse Solana transaction type from instructions
 */
export function parseSolanaTransactionType(
  instructions: unknown[],
  userAddress: string,
  preBalances: number[],
  postBalances: number[],
  accountKeys: string[]
): 'transfer_in' | 'transfer_out' | 'swap' | 'stake' | 'unstake' | 'other' {
  // Find user's account index
  const userIndex = accountKeys.findIndex(key => key === userAddress);
  if (userIndex === -1) return 'other';

  const preBalance = preBalances[userIndex] || 0;
  const postBalance = postBalances[userIndex] || 0;
  const balanceChange = postBalance - preBalance;

  // Check for system program transfers (most common)
  const hasSystemTransfer = instructions.some(ix =>
    ix.program === 'system' || ix.programId === '11111111111111111111111111111112'
  );

  if (hasSystemTransfer) {
    // Positive balance change = receiving SOL
    // Negative balance change = sending SOL
    return balanceChange > 0 ? 'transfer_in' : 'transfer_out';
  }

  // Check for token program instructions
  const hasTokenProgram = instructions.some(ix =>
    ix.program === 'spl-token' || ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  );

  if (hasTokenProgram) {
    return 'swap'; // Most token operations are swaps/trades
  }

  // Check for staking programs
  const hasStakeProgram = instructions.some(ix =>
    ix.program === 'stake' || ix.programId === 'Stake11111111111111111111111111111111111111'
  );

  if (hasStakeProgram) {
    return balanceChange < 0 ? 'stake' : 'unstake';
  }

  return 'other';
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