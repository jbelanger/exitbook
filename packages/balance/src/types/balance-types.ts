// Balance verification types
export interface BalanceComparison {
  currency: string;
  liveBalance: number;
  calculatedBalance: number;
  difference: number;
  status: 'match' | 'mismatch' | 'warning';
  percentageDiff: number;
  tolerance: number;
}

export interface BalanceVerificationResult {
  exchange: string;
  timestamp: number;
  status: 'success' | 'error' | 'warning';
  comparisons: BalanceComparison[];
  error?: string;
  note?: string;
  summary: {
    totalCurrencies: number;
    matches: number;
    mismatches: number;
    warnings: number;
  };
}

export interface BalanceVerificationRecord {
  id?: number;
  exchange: string;
  currency: string;
  expected_balance: number;
  actual_balance: number;
  difference: number;
  status: string;
  timestamp: number;
  created_at?: number;
}

export interface BalanceSnapshot {
  id?: number;
  exchange: string;
  currency: string;
  balance: number;
  timestamp: number;
  created_at: number;
}

// Balance service abstraction
export interface IBalanceService {
  /**
   * Get the unique identifier for this balance service (exchange/blockchain name)
   */
  getServiceId(): string;

  /**
   * Get current balances as a currency -> amount mapping
   */
  getBalances(): Promise<Record<string, number>>;

  /**
   * Whether this service supports live balance fetching
   */
  supportsLiveBalanceFetching(): boolean;

  /**
   * Get service capabilities for display purposes
   */
  getCapabilities(): ServiceCapabilities;

  /**
   * Test if the service is available and working
   */
  testConnection(): Promise<boolean>;

  /**
   * Clean up resources
   */
  close(): Promise<void>;
}

export interface ServiceCapabilities {
  fetchBalance: boolean;
  name: string;
  version?: string;
}