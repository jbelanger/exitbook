import type { AccountType } from '@exitbook/core';

import type { StoredBalanceAssetDiagnostics, StoredBalanceAssetViewItem } from '../../shared/stored-balance-view.js';

export type AssetDiagnostics = StoredBalanceAssetDiagnostics;
export type StoredSnapshotAssetItem = StoredBalanceAssetViewItem;

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

export interface AccountVerificationItem {
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

export type BalanceEvent =
  | { accountId: number; type: 'VERIFICATION_STARTED' }
  | { accountId: number; result: AccountVerificationItem; type: 'VERIFICATION_COMPLETED' }
  | { accountId: number; reason: string; type: 'VERIFICATION_SKIPPED' }
  | { accountId: number; error: string; type: 'VERIFICATION_ERROR' }
  | { type: 'ALL_VERIFICATIONS_COMPLETE' }
  | { type: 'ABORTING' };
