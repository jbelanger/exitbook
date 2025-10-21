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
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  timestamp: number;
  status: 'success' | 'warning' | 'failed';
  comparisons: BalanceComparison[];
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  suggestion?: string | undefined;
}
