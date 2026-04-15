import type { AssetMovementDraft, FeeMovementDraft, FeeMovement, Transaction } from '@exitbook/core';
import { isFiat, parseCurrency } from '@exitbook/foundation';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { AccountingEntry } from '../../accounting-layer/accounting-entry-types.js';
import type { AccountingLayerBuildResult } from '../../accounting-layer/accounting-layer-types.js';
import { buildAccountingLayerFromScopedBuild } from '../../accounting-layer/build-accounting-layer-from-transactions.js';
import type { IPriceCoverageData } from '../../ports/transaction-price-coverage.js';
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

export function validateAccountingLayerPrices(
  accountingLayerBuild: AccountingLayerBuildResult,
  requiredCurrency: string
): Result<PriceValidationResult, Error> {
  const priceCoverageSummaryResult = summarizeAccountingLayerPriceCoverage(accountingLayerBuild);
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
    for (const dependency of accountingLayerBuild.derivationDependencies) {
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

  const rebuildTransactions = accountingLayerBuild.processedTransactions.filter((transaction) =>
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

function summarizeAccountingLayerPriceCoverage(
  accountingLayerBuild: AccountingLayerBuildResult
): Result<PriceCoverageSummary, Error> {
  const movementByFingerprintResult = buildMovementByFingerprint(accountingLayerBuild.processedTransactions);
  if (movementByFingerprintResult.isErr()) {
    return err(movementByFingerprintResult.error);
  }
  const movementByFingerprint = movementByFingerprintResult.value;

  const ownerHasCompletePrices = new Map<string, boolean>();
  for (const entry of accountingLayerBuild.entries) {
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

function buildAccountingLayerForPriceValidation(
  transactions: Transaction[],
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<AccountingLayerBuildResult, Error> {
  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, accountingExclusionPolicy);
  return buildAccountingLayerFromScopedBuild(exclusionApplied.scopedBuildResult);
}

export function getCostBasisRebuildTransactions(
  transactions: Transaction[],
  requiredCurrency: string,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<PriceValidationResult, Error> {
  const accountingLayerResult = buildAccountingLayerForPriceValidation(transactions, accountingExclusionPolicy);
  if (accountingLayerResult.isErr()) {
    return err(accountingLayerResult.error);
  }

  return validateAccountingLayerPrices(accountingLayerResult.value, requiredCurrency);
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

    const accountingLayerResult = buildAccountingLayerForPriceValidation(
      currentTransactions,
      accountingExclusionPolicy
    );
    if (accountingLayerResult.isErr()) {
      return err(accountingLayerResult.error);
    }

    const validationResult = validateAccountingLayerPrices(accountingLayerResult.value, requiredCurrency);
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

    const accountingLayerResult = buildAccountingLayerForPriceValidation(filtered, accountingExclusionPolicy);
    if (accountingLayerResult.isErr()) {
      return yield* accountingLayerResult;
    }

    const priceCoverageSummaryResult = summarizeAccountingLayerPriceCoverage(accountingLayerResult.value);
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
