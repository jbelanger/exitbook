import type {
  LedgerStressAccountSummary,
  LedgerStressDiff,
  LedgerStressDiffStatus,
  LedgerStressExpectedDiff,
  LedgerStressResult,
  LedgerStressScopeResult,
  LedgerStressScopeStatus,
  LedgerStressStaleExpectedDiff,
  LedgerStressStatus,
} from './ledger-stress-types.js';

export const NEAR_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA = 'exitbook.near-ledger-stress.expected-diffs.v1';

export type NearLedgerStressStatus = LedgerStressStatus;
export type NearLedgerStressScopeStatus = LedgerStressScopeStatus;
export type NearLedgerStressDiffStatus = LedgerStressDiffStatus;
export type NearLedgerStressAccountSummary = LedgerStressAccountSummary;
export type NearLedgerStressExpectedDiff = LedgerStressExpectedDiff;
export type NearLedgerStressDiff = LedgerStressDiff;
export type NearLedgerStressStaleExpectedDiff = LedgerStressStaleExpectedDiff;
export type NearLedgerStressScopeResult = LedgerStressScopeResult;
export type NearLedgerStressResult = LedgerStressResult;
