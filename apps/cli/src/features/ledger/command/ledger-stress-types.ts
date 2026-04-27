import type { Account } from '@exitbook/core';

export type LedgerStressStatus = 'failed' | 'passed';
export type LedgerStressScopeStatus = 'accepted_diffs' | 'failed' | 'passed' | 'unavailable';
export type LedgerStressDiffStatus = 'accepted_diff' | 'unexpected_diff';

export interface LedgerStressAccountSummary {
  id: number;
  accountFingerprint: string;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
  type: Account['accountType'];
}

export interface LedgerStressExpectedDiff {
  accountFingerprint: string;
  assetId: string;
  balanceCategory: string;
  delta: string;
  reason: string;
}

export interface LedgerStressDiff {
  account: LedgerStressAccountSummary;
  assetId: string;
  assetSymbol: string;
  balanceCategory: string;
  delta: string;
  expectedReason?: string | undefined;
  journalFingerprints: readonly string[];
  ledgerQuantity: string;
  postingFingerprints: readonly string[];
  referenceQuantity: string;
  sourceActivityFingerprints: readonly string[];
  status: LedgerStressDiffStatus;
}

export interface LedgerStressStaleExpectedDiff extends LedgerStressExpectedDiff {
  diffKey: string;
}

export interface LedgerStressScopeResult {
  account: LedgerStressAccountSummary;
  diagnostics: {
    ledgerJournals: number;
    ledgerPostings: number;
    ledgerSourceActivities: number;
    legacyTransactions: number;
    rawRows: number;
    reason?: string | undefined;
  };
  diffs: LedgerStressDiff[];
  status: LedgerStressScopeStatus;
}

export interface LedgerStressResult {
  chains: string[];
  scopes: LedgerStressScopeResult[];
  staleExpectedDiffs: LedgerStressStaleExpectedDiff[];
  status: LedgerStressStatus;
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
