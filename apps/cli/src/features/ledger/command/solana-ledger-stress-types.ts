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

export const SOLANA_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA = 'exitbook.solana-ledger-stress.expected-diffs.v1';

export type SolanaLedgerStressStatus = LedgerStressStatus;
export type SolanaLedgerStressScopeStatus = LedgerStressScopeStatus;
export type SolanaLedgerStressDiffStatus = LedgerStressDiffStatus;
export type SolanaLedgerStressAccountSummary = LedgerStressAccountSummary;
export type SolanaLedgerStressExpectedDiff = LedgerStressExpectedDiff;
export type SolanaLedgerStressDiff = LedgerStressDiff;
export type SolanaLedgerStressStaleExpectedDiff = LedgerStressStaleExpectedDiff;
export type SolanaLedgerStressScopeResult = LedgerStressScopeResult;
export type SolanaLedgerStressResult = LedgerStressResult;
