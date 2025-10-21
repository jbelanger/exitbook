/**
 * Fund flow analysis result for exchange transactions
 *
 * Similar to EvmFundFlow but simplified for exchange data.
 * Exchange ledger entries group by correlation IDs (refid, referenceId, etc.)
 * to form atomic operations like swaps, deposits, and withdrawals.
 */
export interface ExchangeFundFlow {
  // All assets that flowed in/out (supports swaps, conversions)
  inflows: {
    amount: string; // Normalized amount
    asset: string; // Symbol (BTC, USD, ETH, etc.)
  }[];
  outflows: {
    amount: string; // Normalized amount
    asset: string; // Symbol (BTC, USD, ETH, etc.)
  }[];

  // Primary asset (for simplified consumption and single-asset display)
  primary: {
    amount: string; // Absolute amount of primary asset
    asset: string; // Symbol of primary asset
  };

  // Fee information (aggregated across all correlated entries)
  fees: {
    amount: string; // Total fee amount
    currency: string; // Fee currency
  }[];

  // Transaction correlation metadata
  entryCount: number; // Number of correlated ledger entries (1 for simple, >1 for complex)
  correlationId: string; // The ID that groups entries together (refid, referenceId, etc.)

  // Timestamps from the ledger entries
  timestamp: number; // Unix timestamp in milliseconds

  // Classification uncertainty tracking
  classificationUncertainty?: string | undefined; // Reason why classification is uncertain
}
