import type { Account, AccountType } from '@exitbook/core';
import type { BalanceVerificationResult } from '@exitbook/ingestion/balance';

import type { StoredBalanceAssetDiagnostics, StoredBalanceAssetViewItem } from '../../shared/stored-balance-view.js';

export interface AssetComparisonItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
  diagnostics: StoredBalanceAssetDiagnostics;
}

export interface AccountsRefreshProgressItem {
  accountId: number;
  platformKey: string;
  accountType: AccountType;
  status: 'pending' | 'verifying' | 'success' | 'warning' | 'failed' | 'skipped' | 'error';
  assetCount: number;
  matchCount: number;
  warningCount: number;
  mismatchCount: number;
  skipReason?: string | undefined;
  errorMessage?: string | undefined;
  comparisons?: AssetComparisonItem[] | undefined;
  warnings?: string[] | undefined;
}

export type AccountsRefreshEvent =
  | { accountId: number; type: 'VERIFICATION_STARTED' }
  | { accountId: number; result: AccountsRefreshProgressItem; type: 'VERIFICATION_COMPLETED' }
  | { accountId: number; reason: string; type: 'VERIFICATION_SKIPPED' }
  | { accountId: number; error: string; type: 'VERIFICATION_ERROR' }
  | { type: 'ALL_VERIFICATIONS_COMPLETE' }
  | { type: 'ABORTING' };

export interface SortedRefreshAccount {
  account: Account;
  accountId: number;
  platformKey: string;
  accountType: AccountType;
  skipReason?: string | undefined;
}

export interface SingleVerificationRefreshResult {
  mode: 'verification';
  account: Account;
  requestedAccount?: Account | undefined;
  comparisons: AssetComparisonItem[];
  verificationResult: BalanceVerificationResult;
  streamMetadata?: Record<string, unknown> | undefined;
}

export interface SingleCalculatedRefreshResult {
  mode: 'calculated-only';
  account: Account;
  requestedAccount?: Account | undefined;
  assets: StoredBalanceAssetViewItem[];
  verificationResult: BalanceVerificationResult;
  streamMetadata?: Record<string, unknown> | undefined;
}

export type SingleRefreshResult = SingleVerificationRefreshResult | SingleCalculatedRefreshResult;

export interface RefreshAccountJsonResult {
  accountId: number;
  platformKey: string;
  accountType: AccountType;
  status: string;
  reason?: string | undefined;
  error?: string | undefined;
  summary?: unknown;
  coverage?: unknown;
  comparisons?: AssetComparisonItem[] | undefined;
  partialFailures?: unknown;
  warnings?: unknown;
}

export interface AllAccountsRefreshResult {
  accounts: RefreshAccountJsonResult[];
  totals: {
    matches: number;
    mismatches: number;
    skipped: number;
    total: number;
    verified: number;
  };
}
