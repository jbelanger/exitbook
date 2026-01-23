import type { CostBasisConfig, FiatCurrency, IJurisdictionRules } from '@exitbook/accounting';
import { CanadaRules, getDefaultDateRange, USRules } from '@exitbook/accounting';
import { Currency, type AssetMovement, type FeeMovement, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

/**
 * CLI options for cost-basis command
 */
export interface CostBasisCommandOptions {
  method?: string | undefined;
  jurisdiction?: string | undefined;
  taxYear?: string | number | undefined;
  fiatCurrency?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

/**
 * Handler parameters for cost-basis calculation
 */
export type CostBasisConfigWithDates = CostBasisConfig & {
  endDate: Date;
  startDate: Date;
};

export interface CostBasisHandlerParams {
  config: CostBasisConfigWithDates;
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
 * Build cost basis parameters from CLI flags
 */
export function buildCostBasisParamsFromFlags(options: CostBasisCommandOptions): Result<CostBasisHandlerParams, Error> {
  // Validate required fields
  if (!options.method) {
    return err(new Error('--method is required (fifo, lifo, specific-id, average-cost)'));
  }
  if (!options.jurisdiction) {
    return err(new Error('--jurisdiction is required (CA, US, UK, EU)'));
  }
  if (!options.taxYear) {
    return err(new Error('--tax-year is required (e.g., 2024)'));
  }

  // Validate method
  const methodResult = validateMethod(options.method);
  if (methodResult.isErr()) {
    return err(methodResult.error);
  }
  const method = methodResult.value;

  // Validate jurisdiction
  const jurisdictionResult = validateJurisdiction(options.jurisdiction);
  if (jurisdictionResult.isErr()) {
    return err(jurisdictionResult.error);
  }
  const jurisdiction = jurisdictionResult.value;

  // Validate tax year
  const taxYearResult = validateTaxYear(options.taxYear);
  if (taxYearResult.isErr()) {
    return err(taxYearResult.error);
  }
  const taxYear = taxYearResult.value;

  // Validate fiat currency if provided
  let currency: FiatCurrency;
  if (options.fiatCurrency) {
    const currencyResult = validateFiatCurrency(options.fiatCurrency);
    if (currencyResult.isErr()) {
      return err(currencyResult.error);
    }
    currency = currencyResult.value;
  } else {
    currency = getDefaultCurrency(jurisdiction);
  }

  // Parse custom dates or use defaults
  let startDate: Date;
  let endDate: Date;

  if (options.startDate || options.endDate) {
    // If either date is provided, both must be provided
    if (!options.startDate || !options.endDate) {
      return err(new Error('Both --start-date and --end-date must be provided together'));
    }

    const startDateResult = parseDate(options.startDate, 'start-date');
    if (startDateResult.isErr()) {
      return err(startDateResult.error);
    }

    const endDateResult = parseDate(options.endDate, 'end-date');
    if (endDateResult.isErr()) {
      return err(endDateResult.error);
    }

    startDate = startDateResult.value;
    endDate = endDateResult.value;

    // Validate date range
    if (startDate >= endDate) {
      return err(new Error('--start-date must be before --end-date'));
    }
  } else {
    // Use default date range for jurisdiction
    const defaultRange = getDefaultDateRange(taxYear, jurisdiction);
    startDate = defaultRange.startDate;
    endDate = defaultRange.endDate;
  }

  const config: CostBasisConfigWithDates = {
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
 * Validate cost basis parameters (business rules + defensive checks for non-CLI callers)
 */
export function validateCostBasisParams(params: CostBasisHandlerParams): Result<void, Error> {
  const { config } = params;

  // Validate method-jurisdiction compatibility
  if (config.method === 'average-cost' && config.jurisdiction !== 'CA') {
    return err(
      new Error('Average Cost (ACB) is only supported for Canada (CA). ' + 'For other jurisdictions, use FIFO or LIFO.')
    );
  }

  // Validate specific-id not yet implemented
  if (config.method === 'specific-id') {
    return err(
      new Error(`Method 'specific-id' is not yet implemented. Currently supported: fifo, lifo, average-cost (CA only)`)
    );
  }

  // Validate jurisdiction has implementation
  if (config.jurisdiction === 'UK' || config.jurisdiction === 'EU') {
    return err(
      new Error(`Jurisdiction '${config.jurisdiction}' tax rules not yet implemented. Currently supported: CA, US`)
    );
  }

  // Defensive check: Validate date range ordering
  // Note: CLI already validates this in buildCostBasisParamsFromFlags, but this
  // protects against invalid params from non-CLI callers
  if (config.startDate >= config.endDate) {
    return err(new Error('Start date must be before end date'));
  }

  return ok();
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
 * Check if a transaction has all required prices
 *
 * Only non-fiat crypto movements need prices. Fiat movements don't need prices
 * since we don't track cost basis for fiat currencies.
 */
export function transactionHasAllPrices(tx: UniversalTransactionData): boolean {
  // Check all non-fiat inflows
  const inflows = tx.movements.inflows ?? [];
  for (const inflow of inflows) {
    if (!movementHasPrice(inflow)) {
      return false;
    }
  }

  // Check all non-fiat outflows
  const outflows = tx.movements.outflows ?? [];
  for (const outflow of outflows) {
    if (!movementHasPrice(outflow)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a movement has a price (or doesn't need one).
 * Fiat currencies don't need prices. Non-fiat currencies and unknown symbols need prices.
 */
function movementHasPrice(movement: AssetMovement | FeeMovement): boolean {
  try {
    const currency = Currency.create(movement.assetSymbol);
    // Fiat currencies don't need prices
    if (currency.isFiat()) {
      return true;
    }
    // Non-fiat currencies (crypto) need prices
    return !!movement.priceAtTxTime;
  } catch {
    // Currency.create() throws for invalid/unknown symbols.
    // Treat unknown symbols as crypto that requires a price.
    return !!movement.priceAtTxTime;
  }
}

/**
 * Validate that transactions have prices in the required currency
 */
export function validateTransactionPrices(
  transactions: UniversalTransactionData[],
  requiredCurrency: string
): Result<{ missingPricesCount: number; validTransactions: UniversalTransactionData[] }, Error> {
  const validTransactions: UniversalTransactionData[] = [];
  let missingPricesCount = 0;

  for (const tx of transactions) {
    // Check if any movements are missing prices
    const hasAllPrices = transactionHasAllPrices(tx);

    if (hasAllPrices) {
      validTransactions.push(tx);
    } else {
      missingPricesCount++;
    }
  }

  // If ALL transactions are missing prices, this is a critical error
  if (validTransactions.length === 0) {
    return err(
      new Error(
        `All transactions are missing price data in ${requiredCurrency}. Please run 'exitbook prices fetch' before calculating cost basis.`
      )
    );
  }

  return ok({ validTransactions, missingPricesCount });
}

/**
 * Get jurisdiction-specific tax rules
 */
export function getJurisdictionRules(jurisdiction: 'CA' | 'US' | 'UK' | 'EU'): IJurisdictionRules {
  switch (jurisdiction) {
    case 'CA':
      return new CanadaRules();
    case 'US':
      return new USRules();
    case 'UK':
    case 'EU':
      throw new Error(`${jurisdiction} jurisdiction rules not yet implemented`);
  }
}

/**
 * Format currency value for display
 */
export function formatCurrency(amount: Decimal, currency: string): string {
  const isNegative = amount.isNegative();
  const absFormatted = amount.abs().toFixed(2);

  // Add thousands separators
  const parts = absFormatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const withSeparators = parts.join('.');

  return `${isNegative ? '-' : ''}${currency} ${withSeparators}`;
}
