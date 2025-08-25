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

export interface BalanceSnapshot {
  balance: number;
  created_at: number;
  currency: string;
  exchange: string;
  id?: number;
  timestamp: number;
}

// Balance service abstraction
export interface IBalanceService {
  /**
   * Clean up resources
   */
  close(): Promise<void>;

  /**
   * Get current balances as a currency -> amount mapping
   */
  getBalances(): Promise<Record<string, number>>;

  /**
   * Get service capabilities for display purposes
   */
  getCapabilities(): ServiceCapabilities;

  /**
   * Get the unique identifier for this balance service (exchange/blockchain name)
   */
  getServiceId(): string;

  /**
   * Whether this service supports live balance fetching
   */
  supportsLiveBalanceFetching(): boolean;

  /**
   * Test if the service is available and working
   */
  testConnection(): Promise<boolean>;
}

export interface ServiceCapabilities {
  fetchBalance: boolean;
  name: string;
  version?: string;
}
