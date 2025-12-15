/**
 * EVM movement object (inflow/outflow/primary)
 */
export interface EvmMovement {
  amount: string; // Normalized amount
  asset: string; // Symbol (ETH, USDC, etc.)
  tokenAddress?: string | undefined; // Contract address for tokens
  tokenDecimals?: number | undefined; // Decimals for tokens
}

/**
 * Unified EVM fund flow analysis result
 *
 * Based on Avalanche's transaction correlation approach, which is the correct
 * baseline for all EVM chains. Supports grouping multiple related transactions
 * (normal, internal, token transfers) by hash for comprehensive analysis.
 */
export interface EvmFundFlow {
  // All assets that flowed in/out (supports swaps, LP, complex DeFi)
  inflows: EvmMovement[];
  outflows: EvmMovement[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: EvmMovement;

  // Fee information (always in native currency)
  feeAmount: string; // Total fee in native currency
  feeCurrency: string; // Native currency symbol (ETH, AVAX, etc.)

  // Address information (always present in fund flow)
  fromAddress: string;
  toAddress?: string | undefined;

  // Transaction correlation and complexity analysis
  // Essential for proper EVM transaction processing across all chains
  transactionCount: number; // Number of correlated transactions (1 for simple, >1 for complex)
  hasContractInteraction: boolean; // Involves smart contract calls
  hasInternalTransactions: boolean; // Has internal/trace transactions
  hasTokenTransfers: boolean; // Has ERC-20/721/1155 transfers

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined; // Reason why classification is uncertain
}
