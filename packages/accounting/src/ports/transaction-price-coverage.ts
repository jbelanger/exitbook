import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

/**
 * Data-access port for loading transactions needed by price coverage checks.
 *
 * The coverage decision logic lives in accounting (checkTransactionPriceCoverage).
 * This port only supplies the data.
 */
export interface IPriceCoverageData {
  loadTransactions(): Promise<Result<Transaction[], Error>>;
}
