import type { Account } from '@exitbook/core';

import type { BalanceCommandStatus } from './balance-command-status.js';
import type { BalancePartialFailure } from './balance-utils.js';

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
  coverage: {
    confidence: 'high' | 'medium' | 'low';
    failedAddresses: number;
    failedAssets: number;
    overallCoverageRatio: number;
    parsedAssets: number;
    requestedAddresses: number;
    status: 'complete' | 'partial';
    successfulAddresses: number;
    totalAssets: number;
  };
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  partialFailures?: BalancePartialFailure[] | undefined;
  suggestion?: string | undefined;
  warnings?: string[] | undefined;
}
