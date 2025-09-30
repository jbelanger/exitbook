// Balance verification types
export interface BalanceComparison {
  calculatedBalance: number;
  currency: string;
  difference: number;
  liveBalance: number;
  percentageDiff: number;
  status: 'match' | 'mismatch' | 'warning';
  tolerance: number;
}

export interface BalanceVerificationResult {
  comparisons: BalanceComparison[];
  error?: string | undefined;
  note?: string | undefined;
  source: string;
  status: 'success' | 'error' | 'warning';
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  timestamp: number;
}
