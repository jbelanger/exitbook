import type { Account, AccountType, BalanceSnapshot } from '@exitbook/core';
import type { BalanceVerificationResult } from '@exitbook/ingestion';

import type { AssetComparisonItem, StoredSnapshotAssetItem } from '../view/balance-view-state.js';

export interface SortedVerificationAccount {
  account: Account;
  accountId: number;
  platformKey: string;
  accountType: AccountType;
  skipReason?: string | undefined;
}

export interface StoredSnapshotAccountResult {
  account: Account;
  assets: StoredSnapshotAssetItem[];
  requestedAccount?: Account | undefined;
  snapshot: BalanceSnapshot;
}

export interface StoredSnapshotBalanceResult {
  accounts: StoredSnapshotAccountResult[];
}

export interface SingleVerificationResult {
  mode: 'verification';
  account: Account;
  requestedAccount?: Account | undefined;
  comparisons: AssetComparisonItem[];
  verificationResult: BalanceVerificationResult;
  streamMetadata?: Record<string, unknown> | undefined;
}

export interface SingleCalculatedSnapshotResult {
  mode: 'calculated-only';
  account: Account;
  requestedAccount?: Account | undefined;
  assets: StoredSnapshotAssetItem[];
  verificationResult: BalanceVerificationResult;
  streamMetadata?: Record<string, unknown> | undefined;
}

export type SingleRefreshResult = SingleVerificationResult | SingleCalculatedSnapshotResult;

export interface AccountJsonResult {
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

export interface AllAccountsVerificationResult {
  accounts: AccountJsonResult[];
  totals: {
    matches: number;
    mismatches: number;
    skipped: number;
    total: number;
    verified: number;
  };
}
