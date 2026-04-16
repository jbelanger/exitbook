import type { AssetMovementDraft, FeeMovementDraft, FeeMovement, Transaction } from '@exitbook/core';
import { isFiat, parseCurrency } from '@exitbook/foundation';
import { err, ok, resultDo, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { AccountingEntry } from '../../accounting-model/accounting-entry-types.js';
import { type AccountingExclusionPolicy } from '../../accounting-model/accounting-exclusion-policy.js';
import type { AccountingModelBuildResult } from '../../accounting-model/accounting-model-types.js';
import { buildAccountingModelFromTransactions } from '../../accounting-model/build-accounting-model-from-transactions.js';
import type { IPriceCoverageData } from '../../ports/transaction-price-coverage.js';

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

interface PriceValidationResult {
  evaluatedTransactionCount: number;
  missingPricesCount: number;
  rebuildTransactions: Transaction[];
}

interface PriceCoverageSummary {
  evaluatedTransactionCount: number;
  missingPricesCount: number;
  ownerHasCompletePrices: Map<string, boolean>;
}

type PricedMovement = AssetMovementDraft | FeeMovementDraft | FeeMovement;

function buildMovementByFingerprint(transactions: readonly Transaction[]): Result<Map<string, PricedMovement>, Error> {
  const movementByFingerprint = new Map<string, PricedMovement>();

  for (const transaction of transactions) {
    for (const movement of transaction.movements.inflows ?? []) {
      movementByFingerprint.set(movement.movementFingerprint, movement);
    }
    for (const movement of transaction.movements.outflows ?? []) {
      movementByFingerprint.set(movement.movementFingerprint, movement);
    }
    for (const fee of transaction.fees ?? []) {
      movementByFingerprint.set(fee.movementFingerprint, fee);
    }
  }

  return ok(movementByFingerprint);
}

function resolveEntryOwnerTxFingerprint(entry: AccountingEntry): Result<string, Error> {
  const ownerTxFingerprints = new Set(entry.provenanceBindings.map((binding) => binding.txFingerprint));
  if (ownerTxFingerprints.size !== 1) {
    return err(
      new Error(
        `Accounting price validation currently requires single-transaction entry ownership; entry ${entry.entryFingerprint} spans ${ownerTxFingerprints.size} transactions`
      )
    );
  }

  return ok([...ownerTxFingerprints][0]!);
}

function accountingEntryHasAllPrices(
  entry: AccountingEntry,
  movementByFingerprint: Map<string, PricedMovement>
): Result<boolean, Error> {
  for (const binding of entry.provenanceBindings) {
    const movement = movementByFingerprint.get(binding.movementFingerprint);
    if (!movement) {
      return err(
        new Error(
          `Accounting price validation could not resolve movement ${binding.movementFingerprint} for entry ${entry.entryFingerprint}`
        )
      );
    }

    const hasPriceResult = movementHasPrice(movement);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  return ok(true);
}

export function validateAccountingModelPrices(
  accountingModelBuild: AccountingModelBuildResult,
  requiredCurrency: string
): Result<PriceValidationResult, Error> {
  const priceCoverageSummaryResult = summarizeAccountingModelPriceCoverage(accountingModelBuild);
  if (priceCoverageSummaryResult.isErr()) {
    return err(priceCoverageSummaryResult.error);
  }

  const { evaluatedTransactionCount, missingPricesCount, ownerHasCompletePrices } = priceCoverageSummaryResult.value;

  const rebuildTransactionFingerprints = new Set<string>();

  for (const [ownerTxFingerprint, hasCompletePrices] of ownerHasCompletePrices) {
    if (!hasCompletePrices) {
      continue;
    }

    rebuildTransactionFingerprints.add(ownerTxFingerprint);
    for (const dependency of accountingModelBuild.derivationDependencies) {
      if (dependency.ownerTxFingerprint === ownerTxFingerprint) {
        rebuildTransactionFingerprints.add(dependency.supportingTxFingerprint);
      }
    }
  }

  if (evaluatedTransactionCount === 0) {
    return ok({
      evaluatedTransactionCount: 0,
      rebuildTransactions: [],
      missingPricesCount: 0,
    });
  }

  if (rebuildTransactionFingerprints.size === 0) {
    return err(
      new Error(
        `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
      )
    );
  }

  const rebuildTransactions = accountingModelBuild.processedTransactions.filter((transaction) =>
    rebuildTransactionFingerprints.has(transaction.txFingerprint)
  );
  if (rebuildTransactions.length !== rebuildTransactionFingerprints.size) {
    const foundFingerprints = new Set(rebuildTransactions.map((transaction) => transaction.txFingerprint));
    const missingTransactionFingerprints = [...rebuildTransactionFingerprints].filter(
      (txFingerprint) => !foundFingerprints.has(txFingerprint)
    );
    return err(
      new Error(
        `Accounting rebuild transactions missing from the input set: [${missingTransactionFingerprints.join(', ')}]`
      )
    );
  }

  return ok({
    evaluatedTransactionCount,
    rebuildTransactions,
    missingPricesCount,
  });
}

function summarizeAccountingModelPriceCoverage(
  accountingModelBuild: AccountingModelBuildResult
): Result<PriceCoverageSummary, Error> {
  const movementByFingerprintResult = buildMovementByFingerprint(accountingModelBuild.processedTransactions);
  if (movementByFingerprintResult.isErr()) {
    return err(movementByFingerprintResult.error);
  }
  const movementByFingerprint = movementByFingerprintResult.value;

  const ownerHasCompletePrices = new Map<string, boolean>();
  for (const entry of accountingModelBuild.entries) {
    const ownerTxFingerprintResult = resolveEntryOwnerTxFingerprint(entry);
    if (ownerTxFingerprintResult.isErr()) {
      return err(ownerTxFingerprintResult.error);
    }

    const hasAllPricesResult = accountingEntryHasAllPrices(entry, movementByFingerprint);
    if (hasAllPricesResult.isErr()) {
      return err(hasAllPricesResult.error);
    }

    const ownerTxFingerprint = ownerTxFingerprintResult.value;
    ownerHasCompletePrices.set(
      ownerTxFingerprint,
      (ownerHasCompletePrices.get(ownerTxFingerprint) ?? true) && hasAllPricesResult.value
    );
  }

  let missingPricesCount = 0;
  for (const hasCompletePrices of ownerHasCompletePrices.values()) {
    if (!hasCompletePrices) {
      missingPricesCount++;
    }
  }

  return ok({
    evaluatedTransactionCount: ownerHasCompletePrices.size,
    missingPricesCount,
    ownerHasCompletePrices,
  });
}

function buildAccountingModelForPriceValidation(
  transactions: Transaction[],
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<AccountingModelBuildResult, Error> {
  return buildAccountingModelFromTransactions(transactions, logger, accountingExclusionPolicy);
}

export function getCostBasisRebuildTransactions(
  transactions: Transaction[],
  requiredCurrency: string,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<PriceValidationResult, Error> {
  return resultDo(function* () {
    const accountingModelBuild = yield* buildAccountingModelForPriceValidation(transactions, accountingExclusionPolicy);
    return yield* validateAccountingModelPrices(accountingModelBuild, requiredCurrency);
  });
}

function buildTransactionIdSetKey(transactions: readonly Transaction[]): string {
  return transactions
    .map((transaction) => transaction.id)
    .sort((left, right) => left - right)
    .join(',');
}

/**
 * Dropping missing-price accounting rows can still leave dependency transactions in the
 * retained raw set. Re-run the accounting validation until the retained transaction ids
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

    const accountingModelResult = buildAccountingModelForPriceValidation(
      currentTransactions,
      accountingExclusionPolicy
    );
    if (accountingModelResult.isErr()) {
      return err(accountingModelResult.error);
    }

    const validationResult = validateAccountingModelPrices(accountingModelResult.value, requiredCurrency);
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

    const accountingModelResult = buildAccountingModelForPriceValidation(filtered, accountingExclusionPolicy);
    if (accountingModelResult.isErr()) {
      return yield* accountingModelResult;
    }

    const priceCoverageSummaryResult = summarizeAccountingModelPriceCoverage(accountingModelResult.value);
    if (priceCoverageSummaryResult.isErr()) {
      return yield* priceCoverageSummaryResult;
    }

    const missingCount = priceCoverageSummaryResult.value.missingPricesCount;

    if (missingCount === 0) {
      return { complete: true, reason: undefined };
    }

    return {
      complete: false,
      reason: `${missingCount} of ${priceCoverageSummaryResult.value.evaluatedTransactionCount} transactions missing prices`,
    };
  });
}
