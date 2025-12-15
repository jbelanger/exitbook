/**
 * NEAR movement object (inflow/outflow/primary)
 */
export interface NearMovement {
  amount: string; // Net amount (after fee deduction for outflows)
  grossAmount?: string | undefined; // Gross amount (before fee deduction, for outflows)
  asset: string;
  decimals?: number | undefined;
  tokenAddress?: string | undefined; // Contract address for NEP-141 tokens
}

/**
 * Result of balance change analysis for NEAR transactions
 */
export interface NearBalanceChangeAnalysis {
  inflows: NearMovement[];
  outflows: NearMovement[];
  primary: NearMovement;
  fromAddress: string;
  toAddress: string;
  feePaidByUser: boolean;
  feeAbsorbedByMovement: boolean;
  classificationUncertainty?: string | undefined;
}

/**
 * NEAR fund flow analysis result - structured for multi-asset tracking
 */
export interface NearFundFlow {
  // Structured asset movements
  inflows: NearMovement[];
  outflows: NearMovement[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: NearMovement;

  // Fee information (always in NEAR)
  feeAmount: string;
  feeCurrency: string;
  feePaidByUser: boolean; // Whether the user paid the transaction fee
  feeAbsorbedByMovement: boolean; // Whether the fee was fully absorbed by movement adjustment

  // Addresses involved
  fromAddress?: string | undefined;
  toAddress?: string | undefined;

  // NEAR-specific analysis
  hasStaking: boolean;
  hasContractCall: boolean;
  hasTokenTransfers: boolean;
  actionTypes: string[]; // List of action types in transaction
  actionCount: number; // Number of actions in transaction

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined;
}
