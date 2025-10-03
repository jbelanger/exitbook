/**
 * Solana token balance information
 */
export interface SolanaTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string | undefined;
  programId?: string | undefined;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount?: number | undefined;
    uiAmountString: string;
  };
}

/**
 * Solana account balance change for fund flow analysis
 */
export interface SolanaAccountChange {
  account: string;
  owner?: string | undefined; // Account owner
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
  owner?: string | undefined; // Token account owner
  postAmount: string; // Token amount after transaction
  preAmount: string; // Token amount before transaction
  symbol?: string | undefined; // Token symbol if known
}

/**
 * Normalized Solana transaction with structured data
 * for sophisticated fund flow analysis in the processor
 */
export interface SolanaTransaction {
  // Balance change data for accurate fund flow analysis
  accountChanges?: SolanaAccountChange[] | undefined; // SOL balance changes for all accounts

  // Value information
  amount: string; // Amount in lamports (for SOL) or token units (for SPL tokens)

  // Block context
  blockHeight?: number | undefined; // For compatibility, maps to slot
  blockId?: string | undefined;

  // Solana-specific transaction data
  computeUnitsConsumed?: number | undefined; // Compute units used
  currency: string; // 'SOL' for native transfers, token symbol for token transfers

  // Fee information (always in SOL)
  feeAmount?: string | undefined; // Fee in lamports
  feeCurrency?: string | undefined; // Always 'SOL'

  // Transaction flow data
  from: string;

  // Core transaction data
  id: string;

  // Instruction-level data
  innerInstructions?: SolanaInstruction[] | undefined; // Cross-program invocations
  instructions?: SolanaInstruction[] | undefined; // All instructions in the transaction
  logMessages?: string[] | undefined; // Transaction log messages
  providerId: string;
  signature?: string | undefined; // Transaction signature

  // Solana uses slots instead of block numbers
  slot?: number | undefined;
  status: 'success' | 'failed' | 'pending';
  timestamp: number;

  // Token-specific information (for SPL token transfers)
  to: string;
  tokenAccount?: string | undefined; // User's token account address
  tokenAddress?: string | undefined; // Mint address for SPL tokens
  tokenChanges?: SolanaTokenChange[] | undefined; // SPL token balance changes
  tokenDecimals?: number | undefined; // Token decimals
  tokenSymbol?: string | undefined; // Token symbol
}

/**
 * Solana instruction data
 */
export interface SolanaInstruction {
  accounts?: string[] | undefined; // Accounts involved in the instruction
  data?: string | undefined; // Raw instruction data
  instructionType?: string | undefined; // Type of instruction (transfer, swap, etc.)
  programId: string | undefined; // Program that executed the instruction
  programName?: string | undefined; // Human-readable program name
}

/**
 * Solana fund flow analysis result - structured for multi-asset tracking
 */
export interface SolanaFundFlow {
  // Analysis metadata
  computeUnitsUsed?: number | undefined; // Compute units consumed

  // Structured asset movements (NEW)
  inflows: {
    amount: string;
    asset: string;
    decimals?: number | undefined;
    tokenAddress?: string | undefined; // Mint address for SPL tokens
  }[];
  outflows: {
    amount: string;
    asset: string;
    decimals?: number | undefined;
    tokenAddress?: string | undefined; // Mint address for SPL tokens
  }[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: {
    amount: string;
    asset: string;
    decimals?: number | undefined;
    tokenAddress?: string | undefined;
  };

  // Fee information (always in SOL)
  feeAmount: string;
  feeCurrency: string;
  feePaidByUser: boolean; // Whether the user paid the transaction fee

  // Addresses involved
  fromAddress?: string | undefined;
  toAddress?: string | undefined;

  // Solana-specific analysis
  hasMultipleInstructions: boolean;
  hasStaking: boolean;
  hasSwaps: boolean;
  hasTokenTransfers: boolean;
  instructionCount: number; // Number of instructions in transaction
  transactionCount: number; // For compatibility (always 1 for Solana)

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined;

  // Deprecated fields (for migration)
  /** @deprecated Use inflows/outflows instead */
  isIncoming?: boolean;
  /** @deprecated Use inflows/outflows instead */
  isOutgoing?: boolean;
  /** @deprecated Use primary.amount instead */
  netAmount?: string;
  /** @deprecated Use primary.amount instead */
  primaryAmount?: string;
  /** @deprecated Use primary.asset instead */
  primarySymbol?: string;
  /** @deprecated Use primary.asset instead */
  currency?: string;
  /** @deprecated */
  tokenAccount?: string | undefined;
  /** @deprecated */
  totalAmount?: string;
}

// Solana RPC API response types for Helius provider
export interface SolanaSignature {
  blockTime?: number | undefined;
  err?: unknown;
  memo?: string | undefined;
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
            uiAmount?: number | undefined;
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
