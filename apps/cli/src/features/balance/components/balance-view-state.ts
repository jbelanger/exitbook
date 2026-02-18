/**
 * Balance view TUI state types, event types, and factory functions.
 */

import type { AccountType } from '@exitbook/core';

import type { DateRange } from '../balance-debug.js';

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface DiagnosticSample {
  amount: string;
  datetime: string;
  from?: string | undefined;
  to?: string | undefined;
  transactionHash?: string | undefined;
}

export interface DiagnosticFeeSample {
  amount: string;
  datetime: string;
  transactionHash?: string | undefined;
}

export interface AssetDiagnostics {
  txCount: number;
  dateRange?: DateRange | undefined;
  totals: {
    fees: string;
    inflows: string;
    net: string;
    outflows: string;
  };
  impliedMissing?: string | undefined;
  topOutflows: DiagnosticSample[];
  topInflows: DiagnosticSample[];
  topFees: DiagnosticFeeSample[];
}

// ─── Asset Items ─────────────────────────────────────────────────────────────

export interface AssetComparisonItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  liveBalance: string;
  difference: string;
  percentageDiff: number;
  status: 'match' | 'warning' | 'mismatch';
  diagnostics: AssetDiagnostics;
}

export interface AssetOfflineItem {
  assetId: string;
  assetSymbol: string;
  calculatedBalance: string;
  isNegative: boolean;
  diagnostics: AssetDiagnostics;
}

// ─── Account Items ───────────────────────────────────────────────────────────

export interface AccountVerificationItem {
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  status: 'pending' | 'verifying' | 'success' | 'warning' | 'failed' | 'skipped' | 'error';
  assetCount: number;
  matchCount: number;
  warningCount: number;
  mismatchCount: number;
  skipReason?: string | undefined;
  errorMessage?: string | undefined;
  comparisons?: AssetComparisonItem[] | undefined;
}

export interface AccountOfflineItem {
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  assetCount: number;
  assets: AssetOfflineItem[];
}

// ─── State Types ─────────────────────────────────────────────────────────────

export interface BalanceVerificationState {
  view: 'accounts';
  phase: 'verifying' | 'complete';
  offline: false;

  accounts: AccountVerificationItem[];
  summary: {
    matches: number;
    mismatches: number;
    skipped: number;
    verified: number;
  };

  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
  aborting?: boolean | undefined;
}

export interface BalanceOfflineState {
  view: 'accounts';
  offline: true;

  accounts: AccountOfflineItem[];
  totalAccounts: number;

  selectedIndex: number;
  scrollOffset: number;

  sourceFilter?: string | undefined;
}

export interface BalanceAssetState {
  view: 'assets';
  offline: boolean;

  accountId: number;
  sourceName: string;
  accountType: AccountType;

  assets: AssetComparisonItem[] | AssetOfflineItem[];
  summary: {
    matches?: number | undefined;
    mismatches?: number | undefined;
    totalAssets: number;
    warnings?: number | undefined;
  };

  selectedIndex: number;
  scrollOffset: number;

  /** Stored parent state for drill-up restoration (undefined = entered via --account-id) */
  parentState?: (BalanceVerificationState | BalanceOfflineState) | undefined;

  error?: string | undefined;
}

export type BalanceState = BalanceVerificationState | BalanceOfflineState | BalanceAssetState;

// ─── Events (for EventRelay in verification mode) ────────────────────────────

export type BalanceEvent =
  | { accountId: number; type: 'VERIFICATION_STARTED' }
  | { accountId: number; result: AccountVerificationItem; type: 'VERIFICATION_COMPLETED' }
  | { accountId: number; reason: string; type: 'VERIFICATION_SKIPPED' }
  | { accountId: number; error: string; type: 'VERIFICATION_ERROR' }
  | { type: 'ALL_VERIFICATIONS_COMPLETE' }
  | { type: 'ABORTING' };

// ─── Actions ─────────────────────────────────────────────────────────────────

export type BalanceAction =
  // Navigation (both views)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Verification events (all-accounts mode)
  | { accountId: number; type: 'VERIFICATION_STARTED' }
  | { accountId: number; result: AccountVerificationItem; type: 'VERIFICATION_COMPLETED' }
  | { accountId: number; reason: string; type: 'VERIFICATION_SKIPPED' }
  | { accountId: number; error: string; type: 'VERIFICATION_ERROR' }
  | { type: 'ALL_VERIFICATIONS_COMPLETE' }

  // Drill-down
  | { type: 'DRILL_DOWN' }
  | { type: 'DRILL_UP' }

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { error: string; type: 'SET_ERROR' }

  // Abort
  | { type: 'ABORTING' };

// ─── Factory Functions ───────────────────────────────────────────────────────

export function createBalanceVerificationState(accounts: AccountVerificationItem[]): BalanceVerificationState {
  const skipped = accounts.filter((a) => a.status === 'skipped').length;
  return {
    view: 'accounts',
    phase: 'verifying',
    offline: false,
    accounts,
    summary: { verified: 0, skipped, matches: 0, mismatches: 0 },
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

export function createBalanceOfflineState(accounts: AccountOfflineItem[], sourceFilter?: string): BalanceOfflineState {
  return {
    view: 'accounts',
    offline: true,
    accounts,
    totalAccounts: accounts.length,
    selectedIndex: 0,
    scrollOffset: 0,
    sourceFilter,
  };
}

export function createBalanceAssetState(
  account: { accountId: number; accountType: AccountType; sourceName: string },
  assets: AssetComparisonItem[] | AssetOfflineItem[],
  options: {
    offline: boolean;
    parentState?: (BalanceVerificationState | BalanceOfflineState) | undefined;
  }
): BalanceAssetState {
  const isOnline = !options.offline;
  let matches: number | undefined;
  let warnings: number | undefined;
  let mismatches: number | undefined;

  if (isOnline) {
    const comparisons = assets as AssetComparisonItem[];
    matches = comparisons.filter((a) => a.status === 'match').length;
    warnings = comparisons.filter((a) => a.status === 'warning').length;
    mismatches = comparisons.filter((a) => a.status === 'mismatch').length;
  }

  return {
    view: 'assets',
    offline: options.offline,
    accountId: account.accountId,
    sourceName: account.sourceName,
    accountType: account.accountType,
    assets,
    summary: {
      totalAssets: assets.length,
      matches,
      warnings,
      mismatches,
    },
    selectedIndex: 0,
    scrollOffset: 0,
    parentState: options.parentState,
  };
}
