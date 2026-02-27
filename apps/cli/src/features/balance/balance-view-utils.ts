/**
 * Balance view utility functions — data transformation, sorting, formatting.
 */

import type { Account, AccountType, ExchangeCredentials } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { BalanceAssetDebugResult } from './balance-debug.js';
import { getExchangeCredentialsFromEnv } from './balance-utils.js';
import type {
  AccountOfflineItem,
  AccountVerificationItem,
  AssetComparisonItem,
  AssetDiagnostics,
  AssetOfflineItem,
  DiagnosticFeeSample,
  DiagnosticSample,
} from './components/balance-view-state.js';

// ─── Diagnostics Builder ─────────────────────────────────────────────────────

/**
 * Transform BalanceAssetDebugResult (Decimal types) → AssetDiagnostics (string types for display).
 */
export function buildAssetDiagnostics(
  debugResult: BalanceAssetDebugResult,
  comparison?: { calculatedBalance: string; liveBalance: string }
): AssetDiagnostics {
  const topOutflows: DiagnosticSample[] = debugResult.topOutflows.map((s) => ({
    amount: s.amount.toFixed(),
    datetime: s.datetime,
    from: s.from,
    to: s.to,
    transactionHash: s.transactionHash,
  }));

  const topInflows: DiagnosticSample[] = debugResult.topInflows.map((s) => ({
    amount: s.amount.toFixed(),
    datetime: s.datetime,
    from: s.from,
    to: s.to,
    transactionHash: s.transactionHash,
  }));

  const topFees: DiagnosticFeeSample[] = debugResult.topFees.map((s) => ({
    amount: s.amount.toFixed(),
    datetime: s.datetime,
    transactionHash: s.transactionHash,
  }));

  const dateRange = debugResult.dateRange;

  // Implied missing = live - calculated (when there's a comparison)
  let impliedMissing: string | undefined;
  if (comparison) {
    const live = parseDecimal(comparison.liveBalance);
    const calculated = parseDecimal(comparison.calculatedBalance);
    const diff = live.minus(calculated);
    if (!diff.isZero()) {
      impliedMissing = diff.toFixed();
    }
  }

  return {
    txCount: debugResult.totals.txCount,
    dateRange,
    totals: {
      inflows: debugResult.totals.inflows.toFixed(),
      outflows: debugResult.totals.outflows.toFixed(),
      fees: debugResult.totals.fees.toFixed(),
      net: debugResult.totals.net.toFixed(),
    },
    impliedMissing,
    topOutflows,
    topInflows,
    topFees,
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
 * Sort offline assets: negative balances first, then by absolute value descending.
 */
export function sortAssetsOffline(assets: AssetOfflineItem[]): AssetOfflineItem[] {
  return [...assets].sort((a, b) => {
    if (a.isNegative && !b.isNegative) return -1;
    if (!a.isNegative && b.isNegative) return 1;
    const absA = parseDecimal(a.calculatedBalance).abs();
    const absB = parseDecimal(b.calculatedBalance).abs();
    return absB.comparedTo(absA);
  });
}

// ─── Credential Resolution ───────────────────────────────────────────────────

export interface CredentialResolution {
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

// ─── Offline Item Builder ────────────────────────────────────────────────────

/**
 * Build AssetOfflineItem from calculated balance and diagnostics.
 */
export function buildAssetOfflineItem(
  assetId: string,
  assetSymbol: string,
  calculatedBalance: Decimal,
  diagnostics: AssetDiagnostics
): AssetOfflineItem {
  return {
    assetId,
    assetSymbol,
    calculatedBalance: calculatedBalance.toFixed(),
    isNegative: calculatedBalance.isNegative(),
    diagnostics,
  };
}

/**
 * Build AccountOfflineItem from an account and its offline assets.
 */
export function buildAccountOfflineItem(account: Account, assets: AssetOfflineItem[]): AccountOfflineItem {
  return {
    accountId: account.id,
    sourceName: account.sourceName,
    accountType: account.accountType,
    assetCount: assets.length,
    assets,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Truncate an address or hash for display (e.g., 0x1234...5678).
 */
export function truncateAddress(address: string, maxLen = 13): string {
  if (address.length <= maxLen) return address;
  const prefixLen = Math.floor((maxLen - 3) / 2);
  const suffixLen = maxLen - 3 - prefixLen;
  return `${address.substring(0, prefixLen)}...${address.substring(address.length - suffixLen)}`;
}

/**
 * Format a balance value with sign prefix for display.
 */
export function formatSignedAmount(amount: string): string {
  if (amount.startsWith('-')) return amount;
  const parsed = parseDecimal(amount);
  if (parsed.isPositive() && !parsed.isZero()) return `+${amount}`;
  return amount;
}
