import type { AssetMovementDraft, FeeMovementDraft, Transaction } from '@exitbook/core';
import { isFiat, parseCurrency } from '@exitbook/foundation';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { IPriceCoverageData } from '../../ports/transaction-price-coverage.js';
import type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
} from '../standard/matching/build-cost-basis-scoped-transactions.js';
import { buildCostBasisScopedTransactions } from '../standard/matching/build-cost-basis-scoped-transactions.js';
import type { AccountingExclusionPolicy } from '../standard/validation/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../standard/validation/accounting-exclusion-policy.js';

const logger = getLogger('cost-basis.workflow.price-completeness');

function movementHasPrice(movement: AssetMovementDraft | FeeMovementDraft): Result<boolean, Error> {
  const rawSymbol = movement.assetSymbol;
  const trimmedSymbol = rawSymbol?.trim();
  if (!trimmedSymbol) {
    logger.warn({ assetSymbol: rawSymbol }, 'Unknown currency symbol');
    return err(new Error("Unknown currency symbol ''"));
  }

  const currencyResult = parseCurrency(trimmedSymbol);
  if (currencyResult.isOk()) {
    if (isFiat(currencyResult.value)) {
      return ok(true);
    }
  } else {
    logger.warn(
      { error: currencyResult.error, assetSymbol: trimmedSymbol },
      'Unknown currency symbol, treating as crypto'
    );
  }

  return ok(!!movement.priceAtTxTime);
}

function filterTransactionsByDateRange(transactions: Transaction[], startDate: Date, endDate: Date): Transaction[] {
  return transactions.filter((tx) => {
    const txDate = new Date(tx.timestamp);
    return txDate >= startDate && txDate <= endDate;
  });
}

function scopedTransactionHasAllPrices(scopedTransaction: AccountingScopedTransaction): Result<boolean, Error> {
  for (const inflow of scopedTransaction.movements.inflows) {
    const hasPriceResult = movementHasPrice(inflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  for (const outflow of scopedTransaction.movements.outflows) {
    const hasPriceResult = movementHasPrice(outflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  for (const fee of scopedTransaction.fees) {
    const hasPriceResult = movementHasPrice(fee);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  return ok(true);
}

export function validateScopedTransactionPrices(
  scopedBuildResult: AccountingScopedBuildResult,
  requiredCurrency: string
): Result<{ missingPricesCount: number; rebuildTransactions: Transaction[] }, Error> {
  const rebuildTransactionIds = new Set<number>();
  let missingPricesCount = 0;

  for (const scopedTransaction of scopedBuildResult.transactions) {
    const hasAllPricesResult = scopedTransactionHasAllPrices(scopedTransaction);
    if (hasAllPricesResult.isErr()) {
      return err(hasAllPricesResult.error);
    }

    if (hasAllPricesResult.value) {
      rebuildTransactionIds.add(scopedTransaction.tx.id);
      for (const dependencyTransactionId of scopedTransaction.rebuildDependencyTransactionIds) {
        rebuildTransactionIds.add(dependencyTransactionId);
      }
    } else {
      missingPricesCount++;
    }
  }

  if (rebuildTransactionIds.size === 0) {
    return err(
      new Error(
        `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
      )
    );
  }

  const rebuildTransactions = scopedBuildResult.inputTransactions.filter((tx) => rebuildTransactionIds.has(tx.id));
  if (rebuildTransactions.length !== rebuildTransactionIds.size) {
    const foundIds = new Set(rebuildTransactions.map((tx) => tx.id));
    const missingTransactionIds = [...rebuildTransactionIds].filter((txId) => !foundIds.has(txId));
    return err(
      new Error(`Scoped rebuild transactions missing from the input set: [${missingTransactionIds.join(', ')}]`)
    );
  }

  return ok({ rebuildTransactions, missingPricesCount });
}

export function getCostBasisRebuildTransactions(
  transactions: Transaction[],
  requiredCurrency: string,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<{ missingPricesCount: number; rebuildTransactions: Transaction[] }, Error> {
  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, accountingExclusionPolicy);
  return validateScopedTransactionPrices(exclusionApplied.scopedBuildResult, requiredCurrency);
}

function buildTransactionIdSetKey(transactions: readonly Transaction[]): string {
  return transactions
    .map((transaction) => transaction.id)
    .sort((left, right) => left - right)
    .join(',');
}

/**
 * Dropping missing-price scoped rows can still leave dependency transactions in the
 * retained raw set. Re-run the scoped validation until the retained transaction ids
 * stop changing so downstream workflows receive a stable, fully priced rebuild subset.
 */
export function stabilizeExcludedRebuildTransactions(
  rebuildTransactions: Transaction[],
  requiredCurrency: string,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<Transaction[], Error> {
  let currentTransactions = rebuildTransactions;
  const seenKeys = new Set<string>();

  while (true) {
    const currentKey = buildTransactionIdSetKey(currentTransactions);
    if (seenKeys.has(currentKey)) {
      return err(new Error(`Price-exclusion rebuild subset failed to converge for transactions [${currentKey}]`));
    }
    seenKeys.add(currentKey);

    const scopedResult = buildCostBasisScopedTransactions(currentTransactions, logger);
    if (scopedResult.isErr()) {
      return err(scopedResult.error);
    }

    const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, accountingExclusionPolicy);
    const validationResult = validateScopedTransactionPrices(exclusionApplied.scopedBuildResult, requiredCurrency);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const nextTransactions = validationResult.value.rebuildTransactions;
    if (buildTransactionIdSetKey(nextTransactions) === currentKey) {
      return ok(nextTransactions);
    }

    currentTransactions = nextTransactions;
  }
}

interface PriceCoverageResult {
  complete: boolean;
  reason: string | undefined;
}

interface PriceCoverageInput {
  startDate: Date;
  endDate: Date;
}

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
