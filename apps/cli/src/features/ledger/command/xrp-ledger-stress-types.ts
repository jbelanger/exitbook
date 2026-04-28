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

export const XRP_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA = 'exitbook.xrp-ledger-stress.expected-diffs.v1';

export type XrpLedgerStressStatus = LedgerStressStatus;
export type XrpLedgerStressScopeStatus = LedgerStressScopeStatus;
export type XrpLedgerStressDiffStatus = LedgerStressDiffStatus;
export type XrpLedgerStressAccountSummary = LedgerStressAccountSummary;
export type XrpLedgerStressExpectedDiff = LedgerStressExpectedDiff;
export type XrpLedgerStressDiff = LedgerStressDiff;
export type XrpLedgerStressStaleExpectedDiff = LedgerStressStaleExpectedDiff;
export type XrpLedgerStressScopeResult = LedgerStressScopeResult;
export type XrpLedgerStressResult = LedgerStressResult;
