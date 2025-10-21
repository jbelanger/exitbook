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
