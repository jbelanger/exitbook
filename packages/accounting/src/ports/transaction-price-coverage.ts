import type { Result, UniversalTransactionData } from '@exitbook/core';

/**
 * Data-access port for loading transactions needed by price coverage checks.
 *
 * The coverage decision logic lives in accounting (checkTransactionPriceCoverage).
 * This port only supplies the data.
 */
export interface IPriceCoverageData {
  loadTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
}
