import {
  isFiat,
  parseCurrency,
  type AssetMovement,
  type FeeMovement,
  type UniversalTransactionData,
} from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import { CanadaRules } from '../jurisdictions/canada-rules.js';
import { USRules } from '../jurisdictions/us-rules.js';
import type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
} from '../matching/build-cost-basis-scoped-transactions.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';

import type { AccountingExclusionPolicy } from './accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from './accounting-exclusion-policy.js';
import type { CostBasisConfig, FiatCurrency } from './cost-basis-config.js';
import { getDefaultDateRange } from './cost-basis-config.js';

const logger = getLogger('cost-basis-utils');

/**
 * Handler parameters for cost-basis calculation
 */
export type ValidatedCostBasisConfig = CostBasisConfig & {
  endDate: Date;
  startDate: Date;
};

export interface CostBasisInput {
  config: ValidatedCostBasisConfig;
}

/**
 * Validate cost basis method
 */
function validateMethod(method: string): Result<CostBasisConfig['method'], Error> {
  const validMethods: CostBasisConfig['method'][] = ['fifo', 'lifo', 'specific-id', 'average-cost'];
  if (!validMethods.includes(method as CostBasisConfig['method'])) {
    return err(new Error(`Invalid method '${method}'. Must be one of: ${validMethods.join(', ')}`));
  }
  return ok(method as CostBasisConfig['method']);
}

/**
 * Validate jurisdiction
 */
function validateJurisdiction(jurisdiction: string): Result<CostBasisConfig['jurisdiction'], Error> {
  const validJurisdictions: CostBasisConfig['jurisdiction'][] = ['CA', 'US', 'UK', 'EU'];
  if (!validJurisdictions.includes(jurisdiction as CostBasisConfig['jurisdiction'])) {
    return err(new Error(`Invalid jurisdiction '${jurisdiction}'. Must be one of: ${validJurisdictions.join(', ')}`));
  }
  return ok(jurisdiction as CostBasisConfig['jurisdiction']);
}

function validateMethodJurisdictionCombination(
  method: CostBasisConfig['method'],
  jurisdiction: CostBasisConfig['jurisdiction']
): Result<void, Error> {
  if (jurisdiction === 'CA' && method !== 'average-cost') {
    return err(new Error(`Canada (CA) cost basis currently supports only average-cost (ACB). Received '${method}'.`));
  }

  if (method === 'average-cost' && jurisdiction !== 'CA') {
    return err(
      new Error('Average Cost (ACB) is only supported for Canada (CA). For other jurisdictions, use FIFO or LIFO.')
    );
  }

  return ok(undefined);
}

/**
 * Validate fiat currency
 */
function validateFiatCurrency(currency: string): Result<FiatCurrency, Error> {
  const validCurrencies: FiatCurrency[] = ['USD', 'CAD', 'EUR', 'GBP'];
  if (!validCurrencies.includes(currency as FiatCurrency)) {
    return err(new Error(`Invalid fiat currency '${currency}'. Must be one of: ${validCurrencies.join(', ')}`));
  }
  return ok(currency as FiatCurrency);
}

/**
 * Validate tax year
 */
function validateTaxYear(year: number | string): Result<number, Error> {
  const yearNum = typeof year === 'string' ? parseInt(year, 10) : year;
  if (isNaN(yearNum)) {
    return err(new Error(`Invalid tax year '${String(year)}'. Must be a valid year (e.g., 2024)`));
  }
  if (yearNum < 2000 || yearNum > 2100) {
    return err(new Error(`Tax year ${yearNum} is out of reasonable range (2000-2100)`));
  }
  return ok(yearNum);
}

/**
 * Get default fiat currency for jurisdiction
 */
function getDefaultCurrency(jurisdiction: CostBasisConfig['jurisdiction']): FiatCurrency {
  const currencyMap: Record<CostBasisConfig['jurisdiction'], FiatCurrency> = {
    CA: 'CAD',
    US: 'USD',
    UK: 'GBP',
    EU: 'EUR',
  };
  return currencyMap[jurisdiction];
}

/**
 * Parse ISO date string
 */
function parseDate(dateStr: string, fieldName: string): Result<Date, Error> {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return err(new Error(`Invalid ${fieldName} '${dateStr}'. Must be ISO date format (YYYY-MM-DD)`));
  }
  return ok(date);
}

/**
 * Check if a movement has a price (or doesn't need one).
 * Fiat currencies don't need prices. Non-fiat currencies and unknown symbols need prices.
 */
function movementHasPrice(movement: AssetMovement | FeeMovement): Result<boolean, Error> {
  const rawSymbol = movement.assetSymbol;
  const trimmedSymbol = rawSymbol?.trim();
  if (!trimmedSymbol) {
    logger.warn({ assetSymbol: rawSymbol }, 'Unknown currency symbol');
    return err(new Error("Unknown currency symbol ''"));
  }

  const currencyResult = parseCurrency(trimmedSymbol);
  if (currencyResult.isOk()) {
    const currency = currencyResult.value;
    // Fiat currencies don't need prices
    if (isFiat(currency)) {
      return ok(true);
    }
  } else {
    logger.warn(
      { error: currencyResult.error, assetSymbol: trimmedSymbol },
      'Unknown currency symbol, treating as crypto'
    );
  }

  // Non-fiat currencies (crypto) need prices
  return ok(!!movement.priceAtTxTime);
}

/**
 * Build cost basis input from validated field values.
 * Shared logic for CLI flag parsing and other callers.
 */
export function buildCostBasisInput(fields: {
  endDate?: string | undefined;
  fiatCurrency?: string | undefined;
  jurisdiction: string;
  method: string;
  startDate?: string | undefined;
  taxYear: number | string;
}): Result<CostBasisInput, Error> {
  const methodResult = validateMethod(fields.method);
  if (methodResult.isErr()) return err(methodResult.error);
  const method = methodResult.value;

  const jurisdictionResult = validateJurisdiction(fields.jurisdiction);
  if (jurisdictionResult.isErr()) return err(jurisdictionResult.error);
  const jurisdiction = jurisdictionResult.value;

  const combinationResult = validateMethodJurisdictionCombination(method, jurisdiction);
  if (combinationResult.isErr()) return err(combinationResult.error);

  const taxYearResult = validateTaxYear(fields.taxYear);
  if (taxYearResult.isErr()) return err(taxYearResult.error);
  const taxYear = taxYearResult.value;

  let currency: FiatCurrency;
  if (fields.fiatCurrency) {
    const currencyResult = validateFiatCurrency(fields.fiatCurrency);
    if (currencyResult.isErr()) return err(currencyResult.error);
    currency = currencyResult.value;
  } else {
    currency = getDefaultCurrency(jurisdiction);
  }

  let startDate: Date;
  let endDate: Date;

  if (fields.startDate || fields.endDate) {
    if (!fields.startDate || !fields.endDate) {
      return err(new Error('Both startDate and endDate must be provided together'));
    }

    const startDateResult = parseDate(fields.startDate, 'startDate');
    if (startDateResult.isErr()) return err(startDateResult.error);

    const endDateResult = parseDate(fields.endDate, 'endDate');
    if (endDateResult.isErr()) return err(endDateResult.error);

    startDate = startDateResult.value;
    endDate = endDateResult.value;

    if (startDate >= endDate) {
      return err(new Error('startDate must be before endDate'));
    }
  } else {
    const defaultRange = getDefaultDateRange(taxYear, jurisdiction);
    startDate = defaultRange.startDate;
    endDate = defaultRange.endDate;
  }

  const config: ValidatedCostBasisConfig = {
    method,
    jurisdiction,
    taxYear,
    currency,
    startDate,
    endDate,
  };

  return ok({ config });
}

/**
 * Validate cost basis input (business rules)
 */
export function validateCostBasisInput(params: CostBasisInput): Result<void, Error> {
  const { config } = params;

  const combinationResult = validateMethodJurisdictionCombination(config.method, config.jurisdiction);
  if (combinationResult.isErr()) return err(combinationResult.error);

  if (config.method === 'specific-id') {
    return err(
      new Error(`Method 'specific-id' is not yet implemented. Currently supported: fifo, lifo, average-cost (CA only)`)
    );
  }

  if (config.jurisdiction === 'UK' || config.jurisdiction === 'EU') {
    return err(
      new Error(`Jurisdiction '${config.jurisdiction}' tax rules not yet implemented. Currently supported: CA, US`)
    );
  }

  if (config.startDate >= config.endDate) {
    return err(new Error('Start date must be before end date'));
  }

  return ok(undefined);
}

/**
 * Filter transactions by date range
 */
export function filterTransactionsByDateRange(
  transactions: UniversalTransactionData[],
  startDate: Date,
  endDate: Date
): UniversalTransactionData[] {
  return transactions.filter((tx) => {
    const txDate = new Date(tx.timestamp);
    return txDate >= startDate && txDate <= endDate;
  });
}

/**
 * Check if a transaction has all required prices.
 * Only non-fiat crypto movements need prices.
 */
export function transactionHasAllPrices(tx: UniversalTransactionData): Result<boolean, Error> {
  const inflows = tx.movements.inflows ?? [];
  for (const inflow of inflows) {
    const hasPriceResult = movementHasPrice(inflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  const outflows = tx.movements.outflows ?? [];
  for (const outflow of outflows) {
    const hasPriceResult = movementHasPrice(outflow);
    if (hasPriceResult.isErr()) return err(hasPriceResult.error);
    if (!hasPriceResult.value) return ok(false);
  }

  return ok(true);
}

/**
 * Check if an accounting-scoped transaction has all required prices.
 * Uses the scoped boundary so removed movements/fees no longer block cost basis.
 */
export function scopedTransactionHasAllPrices(scopedTransaction: AccountingScopedTransaction): Result<boolean, Error> {
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

/**
 * Validate that transactions have prices, returning valid subset and missing count.
 * Returns an error only when ALL transactions are missing prices.
 */
export function validateTransactionPrices(
  transactions: UniversalTransactionData[],
  requiredCurrency: string
): Result<{ missingPricesCount: number; priceCompleteTransactions: UniversalTransactionData[] }, Error> {
  const priceCompleteTransactions: UniversalTransactionData[] = [];
  let missingPricesCount = 0;

  for (const tx of transactions) {
    const hasAllPricesResult = transactionHasAllPrices(tx);

    if (hasAllPricesResult.isErr()) {
      return err(hasAllPricesResult.error);
    }

    if (hasAllPricesResult.value) {
      priceCompleteTransactions.push(tx);
    } else {
      missingPricesCount++;
    }
  }

  if (priceCompleteTransactions.length === 0) {
    return err(
      new Error(
        `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
      )
    );
  }

  return ok({ priceCompleteTransactions, missingPricesCount });
}

/**
 * Validate scoped transactions for cost basis price completeness.
 * Returns the original raw transactions that still survive at the scoped boundary.
 */
export function validateScopedTransactionPrices(
  scopedBuildResult: AccountingScopedBuildResult,
  requiredCurrency: string
): Result<{ missingPricesCount: number; priceCompleteTransactions: UniversalTransactionData[] }, Error> {
  const priceCompleteTransactions: UniversalTransactionData[] = [];
  let missingPricesCount = 0;

  for (const scopedTransaction of scopedBuildResult.transactions) {
    const hasAllPricesResult = scopedTransactionHasAllPrices(scopedTransaction);
    if (hasAllPricesResult.isErr()) {
      return err(hasAllPricesResult.error);
    }

    if (hasAllPricesResult.value) {
      priceCompleteTransactions.push(scopedTransaction.tx);
    } else {
      missingPricesCount++;
    }
  }

  if (priceCompleteTransactions.length === 0) {
    return err(
      new Error(
        `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
      )
    );
  }

  return ok({ priceCompleteTransactions, missingPricesCount });
}

/**
 * Return the raw transaction subset that survives scoped price validation.
 */
export function getPriceCompleteCostBasisTransactions(
  transactions: UniversalTransactionData[],
  requiredCurrency: string,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<{ missingPricesCount: number; priceCompleteTransactions: UniversalTransactionData[] }, Error> {
  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, accountingExclusionPolicy);
  return validateScopedTransactionPrices(exclusionApplied.scopedBuildResult, requiredCurrency);
}

/**
 * Get jurisdiction-specific tax rules
 */
export function getJurisdictionRules(jurisdiction: 'CA' | 'US' | 'UK' | 'EU'): Result<IJurisdictionRules, Error> {
  switch (jurisdiction) {
    case 'CA':
      return ok(new CanadaRules());
    case 'US':
      return ok(new USRules());
    case 'UK':
    case 'EU':
      return err(new Error(`${jurisdiction} jurisdiction rules not yet implemented`));
  }
}

/**
 * Format currency value for display
 */
export function formatCurrency(amount: Decimal, currency: string): string {
  const isNegative = amount.isNegative();
  const absFormatted = amount.abs().toFixed(2);

  const parts = absFormatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const withSeparators = parts.join('.');

  return `${isNegative ? '-' : ''}${currency} ${withSeparators}`;
}
