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

export interface ReprocessCommandResult {
  status: 'success' | 'warning';
  reprocess: {
    counts: {
      processed: number;
    };
    processingErrors?: string[] | undefined;
  };
}

export interface EvmFamilyLedgerStressCommandResult {
  chains: string[];
  scopes: {
    account: {
      accountFingerprint: string;
      id: number;
      identifier: string;
      name?: string | undefined;
      platformKey: string;
      type: string;
    };
    diagnostics: {
      ledgerJournals: number;
      ledgerPostings: number;
      ledgerSourceActivities: number;
      legacyTransactions: number;
      rawRows: number;
      reason?: string | undefined;
    };
    diffs: unknown[];
    status: 'accepted_diffs' | 'failed' | 'passed' | 'unavailable';
  }[];
  staleExpectedDiffs: unknown[];
  status: 'failed' | 'passed';
  summary: {
    acceptedDiffs: number;
    checkedAccounts: number;
    failedAccounts: number;
    ledgerJournals: number;
    ledgerPostings: number;
    ledgerSourceActivities: number;
    legacyTransactions: number;
    passedAccounts: number;
    rawRows: number;
    staleExpectedDiffs: number;
    unavailableAccounts: number;
    unexpectedDiffs: number;
  };
}

export interface AccountsBrowseItem {
  accountFingerprint: string;
  accountType: string;
  id: number;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
}

export interface AccountsBrowseCommandResult {
  data: AccountsBrowseItem[];
  meta: {
    count: number;
    filters?: Record<string, unknown> | undefined;
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}

export interface AccountsRefreshVerificationBalance {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  difference: string;
  liveBalance: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
}

export interface AccountsRefreshCalculatedBalance {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
}

export interface AccountsRefreshCommandResult {
  mode: 'verification' | 'calculated-only';
  status: 'success' | 'warning' | 'failed';
  balances: (AccountsRefreshCalculatedBalance | AccountsRefreshVerificationBalance)[];
  summary: {
    matches: number;
    mismatches: number;
    totalBalanceRows: number;
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
    platformKey: string;
    providerName: string | null;
    type: string;
  };
  meta: {
    timestamp: string;
  };
  requestedAccount?: {
    id: number;
    identifier: string | null;
    platformKey: string;
    providerName: string | null;
    type: string;
  };
  suggestion?: string | undefined;
  warnings?: string[] | undefined;
}
