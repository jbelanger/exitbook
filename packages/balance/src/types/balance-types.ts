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
  error?: string;
  exchange: string;
  note?: string;
  status: 'success' | 'error' | 'warning';
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  timestamp: number;
}

export interface BalanceVerificationRecord {
  actual_balance: number;
  created_at?: number;
  currency: string;
  difference: number;
  exchange: string;
  expected_balance: number;
  id?: number;
  status: string;
  timestamp: number;
}
