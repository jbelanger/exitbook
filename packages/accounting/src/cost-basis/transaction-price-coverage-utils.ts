import { resultDoAsync, type Result } from '@exitbook/core';

import type { IPriceCoverageData } from '../ports/transaction-price-coverage.js';

import { filterTransactionsByDateRange, transactionHasAllPrices } from './cost-basis-utils.js';

export interface PriceCoverageResult {
  complete: boolean;
  reason: string | undefined;
}

export interface PriceCoverageInput {
  startDate: Date;
  endDate: Date;
}

/**
 * Checks whether all transactions in the given date range have complete price data.
 *
 * This is an accounting policy question: which movements need prices, what counts
 * as "missing", and how to filter by date range are all domain rules.
 */
export function checkTransactionPriceCoverage(
  data: IPriceCoverageData,
  input: PriceCoverageInput
): Promise<Result<PriceCoverageResult, Error>> {
  return resultDoAsync(async function* () {
    const allTransactions = yield* await data.loadTransactions();

    const filtered = filterTransactionsByDateRange(allTransactions, input.startDate, input.endDate);
    if (filtered.length === 0) {
      return { complete: true, reason: undefined };
    }

    let missingCount = 0;
    for (const tx of filtered) {
      const hasPrices = yield* transactionHasAllPrices(tx);
      if (!hasPrices) {
        missingCount++;
      }
    }

    if (missingCount === 0) {
      return { complete: true, reason: undefined };
    }

    return {
      complete: false,
      reason: `${missingCount} of ${filtered.length} transactions missing prices`,
    };
  });
}
