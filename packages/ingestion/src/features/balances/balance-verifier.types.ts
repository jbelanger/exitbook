import type { Account, BalanceCommandStatus } from '@exitbook/core';

/**
 * Comparison result for a single asset balance
 */
export interface BalanceComparison {
  assetId: string; // Unique asset identity (e.g., blockchain:ethereum:0xa0b8...)
  assetSymbol: string; // Display symbol (e.g., USDC, ETH)
  currency: string; // Deprecated: use assetSymbol for display, assetId for identity
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
}

/**
 * Complete verification result for an account
 */
export interface BalanceVerificationResult {
  account: Account;
  timestamp: number;
  status: BalanceCommandStatus;
  comparisons: BalanceComparison[];
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  suggestion?: string | undefined;
}
