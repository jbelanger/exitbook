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
  exchange: string;
  note?: string | undefined;
  status: 'success' | 'error' | 'warning';
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  timestamp: number;
}
