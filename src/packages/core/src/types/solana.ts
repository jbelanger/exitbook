import { Decimal } from 'decimal.js';

/**
 * Solana network configuration
 */
export interface SolanaNetworkConfig {
  name: string;
  displayName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  rpcUrl: string;
  explorerApiUrl?: string;
  cluster: 'mainnet-beta' | 'testnet' | 'devnet';
}

/**
 * Supported Solana networks
 */
export const SOLANA_NETWORKS: Record<string, SolanaNetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Solana Mainnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9, // SOL has 9 decimal places (lamports)
    rpcUrl: 'https://api.mainnet-beta.solana.com', // Fallback - Official Solana RPC (40 req/10sec per RPC)
    explorerApiUrl: 'https://api.solscan.io',
    cluster: 'mainnet-beta'
  },
  testnet: {
    name: 'testnet',
    displayName: 'Solana Testnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9,
    rpcUrl: 'https://api.testnet.solana.com',
    explorerApiUrl: 'https://api-testnet.solscan.io',
    cluster: 'testnet'
  },
  devnet: {
    name: 'devnet',
    displayName: 'Solana Devnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9,
    rpcUrl: 'https://api.devnet.solana.com',
    explorerApiUrl: 'https://api-devnet.solscan.io',
    cluster: 'devnet'
  }
};

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
    params?: any;
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
    err: any;
    fee: number;
    innerInstructions: any[];
    logMessages: string[];
    postBalances: number[];
    postTokenBalances: any[];
    preBalances: number[];
    preTokenBalances: any[];
    rewards: any[];
    status: { Ok: null } | { Err: any };
  };
  blockTime: number;
}

/**
 * Solana address validation
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and typically 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number | string): Decimal {
  return new Decimal(lamports).dividedBy(new Decimal(10).pow(9));
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number | string): Decimal {
  return new Decimal(sol).mul(new Decimal(10).pow(9));
}

/**
 * Parse Solana transaction type from instructions
 */
export function parseSolanaTransactionType(
  instructions: any[],
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
    data?: any;
  }>;
}