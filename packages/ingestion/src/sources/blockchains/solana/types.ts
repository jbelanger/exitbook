import type { Currency } from '@exitbook/core';

/**
 * Solana movement object (inflow/outflow/primary)
 */
export interface SolanaMovement {
  amount: string;
  asset: Currency;
  decimals?: number | undefined;
  tokenAddress?: string | undefined; // Mint address for SPL tokens
}

/**
 * Result of balance change analysis for Solana transactions
 */
export interface SolanaFlowAnalysis {
  inflows: SolanaMovement[];
  outflows: SolanaMovement[];
  primary: SolanaMovement;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
  feePaidByUser: boolean;
  feeAbsorbedByMovement: boolean;
  classificationUncertainty?: string | undefined;
  inferenceFailureReason?: string | undefined; // Why from/to couldn't be inferred
}

/**
 * Solana fund flow analysis result - structured for multi-asset tracking
 */
export interface SolanaFundFlow {
  // Analysis metadata
  computeUnitsUsed?: number | undefined; // Compute units consumed

  // Structured asset movements (NEW)
  inflows: SolanaMovement[];
  outflows: SolanaMovement[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: SolanaMovement;

  // Fee information (always in SOL)
  feeAmount: string;
  feeCurrency: Currency;
  feePaidByUser: boolean; // Whether the user paid the transaction fee
  feeAbsorbedByMovement: boolean; // Whether the fee was fully absorbed by movement adjustment

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
  inferenceFailureReason?: string | undefined; // Why from/to couldn't be inferred
}
