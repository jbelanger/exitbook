/**
 * Balance view utility functions — data transformation, sorting, formatting.
 */

import type { Account, AccountType, BalanceSnapshot, ExchangeCredentials } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import { getExchangeCredentialsFromEnv } from '../command/balance-utils.js';
import type { BalanceAssetDiagnosticsSummary } from '../shared/balance-diagnostics.js';

import type {
  StoredSnapshotAccountItem,
  AccountVerificationItem,
  AssetComparisonItem,
  AssetDiagnostics,
  StoredSnapshotAssetItem,
} from './balance-view-state.js';

// ─── Diagnostics Builder ─────────────────────────────────────────────────────

/**
 * Transform BalanceAssetDiagnosticsSummary (Decimal types) → AssetDiagnostics (string types for display).
 */
export function buildAssetDiagnostics(
  diagnosticsSummary: BalanceAssetDiagnosticsSummary,
  comparison?: { calculatedBalance: string; liveBalance: string }
): AssetDiagnostics {
  const dateRange = diagnosticsSummary.dateRange;

  let unexplainedDelta: string | undefined;
  if (comparison) {
    const live = parseDecimal(comparison.liveBalance);
    const calculated = parseDecimal(comparison.calculatedBalance);
    const diff = live.minus(calculated);
    if (!diff.isZero()) {
      unexplainedDelta = diff.toFixed();
    }
  }

  return {
    txCount: diagnosticsSummary.totals.txCount,
    dateRange,
    totals: {
      inflows: diagnosticsSummary.totals.inflows.toFixed(),
      outflows: diagnosticsSummary.totals.outflows.toFixed(),
      fees: diagnosticsSummary.totals.fees.toFixed(),
      net: diagnosticsSummary.totals.net.toFixed(),
    },
    unexplainedDelta,
  };
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_PRIORITY: Record<AccountType, number> = {
  blockchain: 0,
  'exchange-api': 1,
  'exchange-csv': 2,
};

/**
 * Sort accounts by verification priority: blockchain first, then exchange-api, then exchange-csv.
 */
export function sortAccountsByVerificationPriority<T extends { accountId: number; accountType: AccountType }>(
  accounts: T[]
): T[] {
  return [...accounts].sort((a, b) => {
    const typeDiff = ACCOUNT_TYPE_PRIORITY[a.accountType] - ACCOUNT_TYPE_PRIORITY[b.accountType];
    if (typeDiff !== 0) return typeDiff;
    return a.accountId - b.accountId;
  });
}

const VERIFICATION_STATUS_PRIORITY: Record<AccountVerificationItem['status'], number> = {
  error: 0,
  failed: 1,
  warning: 2,
  success: 3,
  verifying: 4,
  pending: 5,
  skipped: 6,
};

/**
 * Sort accounts by status: errors first, then mismatches, warnings, matches, skipped.
 */
export function sortAccountsByStatus(accounts: AccountVerificationItem[]): AccountVerificationItem[] {
  return [...accounts].sort((a, b) => {
    const statusDiff = VERIFICATION_STATUS_PRIORITY[a.status] - VERIFICATION_STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.accountId - b.accountId;
  });
}

const ASSET_STATUS_PRIORITY: Record<AssetComparisonItem['status'], number> = {
  mismatch: 0,
  warning: 1,
  match: 2,
};

/**
 * Sort assets by status: mismatches first, then warnings, then matches.
 */
export function sortAssetsByStatus(assets: AssetComparisonItem[]): AssetComparisonItem[] {
  return [...assets].sort((a, b) => {
    const statusDiff = ASSET_STATUS_PRIORITY[a.status] - ASSET_STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.assetSymbol.localeCompare(b.assetSymbol);
  });
}

/**
 * Sort stored snapshot assets: negative balances first, then by absolute value descending.
 */
export function sortStoredSnapshotAssets(assets: StoredSnapshotAssetItem[]): StoredSnapshotAssetItem[] {
  return [...assets].sort((a, b) => {
    if (a.isNegative && !b.isNegative) return -1;
    if (!a.isNegative && b.isNegative) return 1;
    const absA = parseDecimal(a.calculatedBalance).abs();
    const absB = parseDecimal(b.calculatedBalance).abs();
    return absB.comparedTo(absA);
  });
}

// ─── Credential Resolution ───────────────────────────────────────────────────

interface CredentialResolution {
  credentials?: ExchangeCredentials | undefined;
  skipReason?: string | undefined;
}

/**
 * Resolve credentials for an account.
 * Resolution order: stored → env → skip.
 */
export function resolveAccountCredentials(account: Account): CredentialResolution {
  // Blockchain accounts need no credentials
  if (account.accountType === 'blockchain') {
    return {};
  }

  // Stored credentials (exchange-api accounts)
  if (account.credentials) {
    return { credentials: account.credentials };
  }

  // Environment variables
  const envResult = getExchangeCredentialsFromEnv(account.sourceName);
  if (envResult.isOk()) {
    return { credentials: envResult.value };
  }

  return { skipReason: 'no credentials' };
}

// ─── Stored Snapshot Item Builder ────────────────────────────────────────────

/**
 * Build StoredSnapshotAssetItem from calculated balance and diagnostics.
 */
export function buildStoredSnapshotAssetItem(
  assetId: string,
  assetSymbol: string,
  calculatedBalance: Decimal,
  diagnostics: AssetDiagnostics
): StoredSnapshotAssetItem {
  return {
    assetId,
    assetSymbol,
    calculatedBalance: calculatedBalance.toFixed(),
    isNegative: calculatedBalance.isNegative(),
    diagnostics,
  };
}

/**
 * Build StoredSnapshotAccountItem from an account and its stored snapshot assets.
 */
export function buildStoredSnapshotAccountItem(
  account: Account,
  assets: StoredSnapshotAssetItem[],
  snapshot?: BalanceSnapshot
): StoredSnapshotAccountItem {
  return {
    accountId: account.id,
    sourceName: account.sourceName,
    accountType: account.accountType,
    assetCount: assets.length,
    assets,
    verificationStatus: snapshot?.verificationStatus,
    statusReason: snapshot?.statusReason,
    suggestion: snapshot?.suggestion,
    lastRefreshAt: snapshot?.lastRefreshAt?.toISOString(),
  };
}
