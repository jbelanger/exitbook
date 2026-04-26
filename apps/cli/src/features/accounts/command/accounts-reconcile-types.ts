import type { Account } from '@exitbook/core';
import type { BalanceReconciliationRow, BalanceReferenceSource } from '@exitbook/ingestion/balance';

export type AccountsReconcileStatus = 'error' | 'issues' | 'matched' | 'partial' | 'unavailable';

export interface AccountsReconcileOptions {
  includeMatchedRows: boolean;
  referenceSource: BalanceReferenceSource;
  strict: boolean;
  tolerance?: string | undefined;
}

export interface AccountsReconcileAccountSummary {
  id: number;
  accountFingerprint: string;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
  type: Account['accountType'];
}

export interface AccountsReconcileRowSummary {
  categoryUnsupported: number;
  matched: number;
  missingReference: number;
  quantityMismatches: number;
  totalRows: number;
  unexpectedReference: number;
}

export interface AccountsReconcileScopeResult {
  account: AccountsReconcileAccountSummary;
  requestedAccount?: AccountsReconcileAccountSummary | undefined;
  rows: BalanceReconciliationRow[];
  status: AccountsReconcileStatus;
  summary: AccountsReconcileRowSummary;
  diagnostics: {
    calculatedAt?: string | undefined;
    journalRefs: number;
    lastRefreshAt?: string | undefined;
    postingRefs: number;
    reason?: string | undefined;
    referenceSource: BalanceReferenceSource;
    sourceActivityRefs: number;
  };
}

export interface AccountsReconcileResult {
  referenceSource: BalanceReferenceSource;
  refreshedLive: boolean;
  scopes: AccountsReconcileScopeResult[];
  status: AccountsReconcileStatus;
  summary: {
    categoryUnsupported: number;
    errors: number;
    issueScopes: number;
    matched: number;
    matchedScopes: number;
    missingReference: number;
    partialScopes: number;
    quantityMismatches: number;
    totalRows: number;
    totalScopes: number;
    unavailableScopes: number;
    unexpectedReference: number;
  };
  tolerance: string;
}
