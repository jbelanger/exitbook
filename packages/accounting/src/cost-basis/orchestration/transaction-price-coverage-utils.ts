import { resultDoAsync, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { IPriceCoverageData } from '../../ports/transaction-price-coverage.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';
import type { AccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import { filterTransactionsByDateRange, scopedTransactionHasAllPrices } from '../shared/cost-basis-utils.js';

interface PriceCoverageResult {
  complete: boolean;
  reason: string | undefined;
}

interface PriceCoverageInput {
  startDate: Date;
  endDate: Date;
}

const logger = getLogger('transaction-price-coverage-utils');

/**
 * Checks whether all transactions in the given date range have complete price data.
 *
 * This is an accounting policy question: which movements need prices, what counts
 * as "missing", and how to filter by date range are all domain rules.
 */
export function checkTransactionPriceCoverage(
  data: IPriceCoverageData,
  input: PriceCoverageInput,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<PriceCoverageResult, Error>> {
  return resultDoAsync(async function* () {
    const allTransactions = yield* await data.loadTransactions();

    const filtered = filterTransactionsByDateRange(allTransactions, input.startDate, input.endDate);
    if (filtered.length === 0) {
      return { complete: true, reason: undefined };
    }

    const scopedResult = buildCostBasisScopedTransactions(filtered, logger);
    if (scopedResult.isErr()) {
      return yield* scopedResult;
    }

    const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, accountingExclusionPolicy);

    let missingCount = 0;
    for (const scopedTransaction of exclusionApplied.scopedBuildResult.transactions) {
      const hasPrices = yield* scopedTransactionHasAllPrices(scopedTransaction);
      if (!hasPrices) {
        missingCount++;
      }
    }

    if (missingCount === 0) {
      return { complete: true, reason: undefined };
    }

    return {
      complete: false,
      reason: `${missingCount} of ${exclusionApplied.scopedBuildResult.transactions.length} transactions missing prices`,
    };
  });
}
