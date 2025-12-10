/**
 * Type definitions for CLI command responses used in e2e tests
 */

export interface ImportCommandResult {
  status: 'success' | 'warning';
  import: {
    accountId?: number;
    counts: {
      imported: number;
      processed?: number;
      skipped: number;
    };
    importSessions?: {
      completedAt?: string;
      files?: number;
      id: number;
      startedAt?: string;
      status?: string;
    }[];
    input: {
      address?: string;
      blockchain?: string;
      csvDir?: string;
      exchange?: string;
      processed: boolean;
    };
    processingErrors?: string[];
    source?: string;
  };
  meta: {
    durationMs?: number;
    timestamp: string;
  };
}

export interface ProcessCommandResult {
  errors: string[];
  processed: number;
}

export interface BalanceCommandResult {
  status: 'success' | 'warning' | 'error';
  balances: {
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
    percentageDiff: number;
    status: 'match' | 'warning' | 'mismatch';
  }[];
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  source: {
    address?: string;
    name: string;
    type: 'exchange' | 'blockchain';
  };
  account: {
    id: number;
    identifier: string | null;
    providerName: string | null;
    sourceName: string;
    type: string;
  };
  meta: {
    timestamp: string;
  };
  suggestion?: string;
}

export interface AccountsViewResult {
  data: {
    accounts: {
      accountType: string;
      id: number;
      identifier: string;
      sourceName: string;
    }[];
  };
  meta: {
    count: number;
    filters?: Record<string, string>;
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}
