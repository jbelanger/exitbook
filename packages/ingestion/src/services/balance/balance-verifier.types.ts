import type { Account, BalanceCommandStatus, SourceType } from '@exitbook/core';

/**
 * Comparison result for a single currency balance
 */
export interface BalanceComparison {
  currency: string;
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
}

/**
 * Complete verification result for a source
 */
export interface BalanceVerificationResult {
  account: Account;
  sourceId: string;
  sourceType: SourceType;
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
