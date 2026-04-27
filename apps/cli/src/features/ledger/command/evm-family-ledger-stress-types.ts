import type { Account } from '@exitbook/core';

export const EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA = 'exitbook.evm-family-ledger-stress.expected-diffs.v1';

export type EvmFamilyLedgerStressStatus = 'failed' | 'passed';
export type EvmFamilyLedgerStressScopeStatus = 'accepted_diffs' | 'failed' | 'passed' | 'unavailable';
export type EvmFamilyLedgerStressDiffStatus = 'accepted_diff' | 'unexpected_diff';

export interface EvmFamilyLedgerStressAccountSummary {
  id: number;
  accountFingerprint: string;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
  type: Account['accountType'];
}

export interface EvmFamilyLedgerStressExpectedDiff {
  accountFingerprint: string;
  assetId: string;
  balanceCategory: string;
  delta: string;
  reason: string;
}

export interface EvmFamilyLedgerStressDiff {
  account: EvmFamilyLedgerStressAccountSummary;
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
  status: EvmFamilyLedgerStressDiffStatus;
}

export interface EvmFamilyLedgerStressStaleExpectedDiff extends EvmFamilyLedgerStressExpectedDiff {
  diffKey: string;
}

export interface EvmFamilyLedgerStressScopeResult {
  account: EvmFamilyLedgerStressAccountSummary;
  diagnostics: {
    ledgerJournals: number;
    ledgerPostings: number;
    ledgerSourceActivities: number;
    legacyTransactions: number;
    rawRows: number;
    reason?: string | undefined;
  };
  diffs: EvmFamilyLedgerStressDiff[];
  status: EvmFamilyLedgerStressScopeStatus;
}

export interface EvmFamilyLedgerStressResult {
  chains: string[];
  scopes: EvmFamilyLedgerStressScopeResult[];
  staleExpectedDiffs: EvmFamilyLedgerStressStaleExpectedDiff[];
  status: EvmFamilyLedgerStressStatus;
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
