/**
 * Balance view TUI state types, event types, and factory functions.
 */

import type { AccountType, BalanceSnapshotVerificationStatus } from '@exitbook/core';

import type { DateRange } from '../shared/balance-diagnostics.js';

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface AssetDiagnostics {
  txCount: number;
  dateRange?: DateRange | undefined;
  totals: {
    fees: string;
    inflows: string;
    net: string;
    outflows: string;
  };
  unexplainedDelta?: string | undefined;
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

export interface StoredSnapshotAssetItem {
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
  warnings?: string[] | undefined;
}

export interface StoredSnapshotAccountItem {
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  assetCount: number;
  assets: StoredSnapshotAssetItem[];
  verificationStatus?: BalanceSnapshotVerificationStatus | undefined;
  statusReason?: string | undefined;
  suggestion?: string | undefined;
  lastRefreshAt?: string | undefined;
}

// ─── State Types ─────────────────────────────────────────────────────────────

export type BalanceViewMode = 'verification' | 'stored-snapshot';

export interface BalanceVerificationState {
  view: 'accounts';
  phase: 'verifying' | 'complete';
  mode: 'verification';

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

export interface BalanceStoredSnapshotState {
  view: 'accounts';
  mode: 'stored-snapshot';

  accounts: StoredSnapshotAccountItem[];
  totalAccounts: number;

  selectedIndex: number;
  scrollOffset: number;

  sourceFilter?: string | undefined;
}

interface BalanceAssetStateBase {
  view: 'assets';
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
  verificationStatus?: BalanceSnapshotVerificationStatus | undefined;
  statusReason?: string | undefined;
  suggestion?: string | undefined;
  lastRefreshAt?: string | undefined;
}

export interface BalanceVerificationAssetState extends BalanceAssetStateBase {
  mode: 'verification';
  assets: AssetComparisonItem[];
  summary: {
    matches: number;
    mismatches: number;
    totalAssets: number;
    warnings: number;
  };
  parentState?: BalanceVerificationState | undefined;
}

export interface BalanceStoredSnapshotAssetState extends BalanceAssetStateBase {
  mode: 'stored-snapshot';
  assets: StoredSnapshotAssetItem[];
  summary: {
    totalAssets: number;
  };
  /** Stored parent state for drill-up restoration (undefined = entered via --account-id) */
  parentState?: BalanceStoredSnapshotState | undefined;
}

export type BalanceAssetState = BalanceVerificationAssetState | BalanceStoredSnapshotAssetState;
export type BalanceState = BalanceVerificationState | BalanceStoredSnapshotState | BalanceAssetState;

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
    mode: 'verification',
    accounts,
    summary: { verified: 0, skipped, matches: 0, mismatches: 0 },
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

export function createBalanceStoredSnapshotState(
  accounts: StoredSnapshotAccountItem[],
  sourceFilter?: string
): BalanceStoredSnapshotState {
  return {
    view: 'accounts',
    mode: 'stored-snapshot',
    accounts,
    totalAccounts: accounts.length,
    selectedIndex: 0,
    scrollOffset: 0,
    sourceFilter,
  };
}

export function createBalanceVerificationAssetState(
  account: { accountId: number; accountType: AccountType; sourceName: string },
  assets: AssetComparisonItem[],
  options?: {
    parentState?: BalanceVerificationState | undefined;
  }
): BalanceVerificationAssetState {
  const matches = assets.filter((a) => a.status === 'match').length;
  const warnings = assets.filter((a) => a.status === 'warning').length;
  const mismatches = assets.filter((a) => a.status === 'mismatch').length;

  return {
    view: 'assets',
    mode: 'verification',
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
    parentState: options?.parentState,
  };
}

export function createBalanceStoredSnapshotAssetState(
  account: {
    accountId: number;
    accountType: AccountType;
    lastRefreshAt?: string | undefined;
    sourceName: string;
    statusReason?: string | undefined;
    suggestion?: string | undefined;
    verificationStatus?: BalanceSnapshotVerificationStatus | undefined;
  },
  assets: StoredSnapshotAssetItem[],
  options?: {
    parentState?: BalanceStoredSnapshotState | undefined;
  }
): BalanceStoredSnapshotAssetState {
  return {
    view: 'assets',
    mode: 'stored-snapshot',
    accountId: account.accountId,
    sourceName: account.sourceName,
    accountType: account.accountType,
    verificationStatus: account.verificationStatus,
    statusReason: account.statusReason,
    suggestion: account.suggestion,
    lastRefreshAt: account.lastRefreshAt,
    assets,
    summary: {
      totalAssets: assets.length,
    },
    selectedIndex: 0,
    scrollOffset: 0,
    parentState: options?.parentState,
  };
}
