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

export const EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA = 'exitbook.evm-family-ledger-stress.expected-diffs.v1';

export type EvmFamilyLedgerStressStatus = LedgerStressStatus;
export type EvmFamilyLedgerStressScopeStatus = LedgerStressScopeStatus;
export type EvmFamilyLedgerStressDiffStatus = LedgerStressDiffStatus;
export type EvmFamilyLedgerStressAccountSummary = LedgerStressAccountSummary;
export type EvmFamilyLedgerStressExpectedDiff = LedgerStressExpectedDiff;
export type EvmFamilyLedgerStressDiff = LedgerStressDiff;
export type EvmFamilyLedgerStressStaleExpectedDiff = LedgerStressStaleExpectedDiff;
export type EvmFamilyLedgerStressScopeResult = LedgerStressScopeResult;
export type EvmFamilyLedgerStressResult = LedgerStressResult;
