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
 * Solana account balance change for fund flow analysis
 */
export interface SolanaAccountChange {
  account: string;
  owner?: string; // Account owner
  postBalance: string; // Balance in lamports after transaction
  preBalance: string; // Balance in lamports before transaction
}

/**
 * Solana token balance change for SPL token analysis
 */
export interface SolanaTokenChange {
  account: string; // Token account address
  decimals: number; // Token decimals
  mint: string; // Token mint address
  owner?: string; // Token account owner
  postAmount: string; // Token amount after transaction
  preAmount: string; // Token amount before transaction
  symbol?: string; // Token symbol if known
}

/**
 * Normalized Solana transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface SolanaTransaction {
  // Balance change data for accurate fund flow analysis
  accountChanges?: SolanaAccountChange[]; // SOL balance changes for all accounts

  // Value information
  amount: string; // Amount in lamports (for SOL) or token units (for SPL tokens)

  // Block context
  blockHeight?: number; // For compatibility, maps to slot
  blockId?: string;

  // Solana-specific transaction data
  computeUnitsConsumed?: number; // Compute units used
  currency: string; // 'SOL' for native transfers, token symbol for token transfers

  // Fee information (always in SOL)
  feeAmount?: string; // Fee in lamports
  feeCurrency?: string; // Always 'SOL'

  // Transaction flow data
  from: string;

  // Core transaction data
  id: string;

  // Instruction-level data
  innerInstructions?: SolanaInstruction[]; // Cross-program invocations
  instructions?: SolanaInstruction[]; // All instructions in the transaction
  logMessages?: string[]; // Transaction log messages
  providerId: string;
  signature?: string; // Transaction signature

  // Solana uses slots instead of block numbers
  slot?: number;
  status: 'success' | 'failed' | 'pending';
  timestamp: number;

  // Token-specific information (for SPL token transfers)
  to: string;
  tokenAccount?: string; // User's token account address
  tokenAddress?: string; // Mint address for SPL tokens
  tokenChanges?: SolanaTokenChange[]; // SPL token balance changes
  tokenDecimals?: number; // Token decimals
  tokenSymbol?: string; // Token symbol

  // Transaction type classification (basic, will be refined by processor)
  type: 'transfer' | 'token_transfer' | 'stake' | 'unstake' | 'swap' | 'other';
}

/**
 * Solana instruction data
 */
export interface SolanaInstruction {
  accounts?: string[]; // Accounts involved in the instruction
  data?: string; // Raw instruction data
  instructionType?: string; // Type of instruction (transfer, swap, etc.)
  programId: string; // Program that executed the instruction
  programName?: string; // Human-readable program name
}

/**
 * Solana fund flow analysis result
 */
export interface SolanaFundFlow {
  // Analysis metadata
  computeUnitsUsed?: number; // Compute units consumed

  // Token information
  currency: string; // SOL or SPL token symbol

  // Fee information (always in SOL)
  feeAmount: string;
  feeCurrency: string;
  feePaidByUser: boolean; // Whether the user paid the transaction fee

  // Addresses involved
  fromAddress?: string;

  // Solana-specific analysis
  hasMultipleInstructions: boolean;
  hasStaking: boolean;
  hasSwaps: boolean;
  hasTokenTransfers: boolean;
  instructionCount: number; // Number of instructions in transaction

  // Fund flow direction
  isIncoming: boolean; // User is receiving funds
  isOutgoing: boolean; // User is sending funds

  // Amount information
  netAmount: string; // Net amount change for user (positive = received, negative = sent)

  // Primary transaction amount and symbol
  primaryAmount: string;
  primarySymbol: string;
  toAddress?: string;
  tokenAccount?: string; // For SPL token transfers

  // Total transaction amount
  totalAmount: string;
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
