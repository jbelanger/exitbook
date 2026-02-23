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
  computeUnitsUsed?: number | undefined;

  inflows: SolanaMovement[];
  outflows: SolanaMovement[];

  // Primary asset for simplified consumption and single-asset display
  primary: SolanaMovement;

  // Fee information (always in SOL)
  feeAmount: string;
  feeCurrency: Currency;
  feePaidByUser: boolean;
  feeAbsorbedByMovement: boolean;

  fromAddress?: string | undefined;
  toAddress?: string | undefined;

  hasMultipleInstructions: boolean;
  hasStaking: boolean;
  hasSwaps: boolean;
  hasTokenTransfers: boolean;
  instructionCount: number;
  transactionCount: number;

  classificationUncertainty?: string | undefined;
  inferenceFailureReason?: string | undefined;
}
