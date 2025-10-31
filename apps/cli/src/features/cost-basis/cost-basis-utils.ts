import type { CostBasisConfig, FiatCurrency } from '@exitbook/accounting';
import { getDefaultDateRange } from '@exitbook/accounting';
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
export interface CostBasisHandlerParams {
  config: CostBasisConfig;
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

  const config: CostBasisConfig = {
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
 * Validate cost basis parameters
 */
export function validateCostBasisParams(params: CostBasisHandlerParams): Result<void, Error> {
  const { config } = params;

  // Validate method is supported
  if (config.method === 'specific-id' || config.method === 'average-cost') {
    return err(
      new Error(
        `Method '${config.method}' is not yet implemented. Currently supported: fifo, lifo. Coming soon: specific-id, average-cost`
      )
    );
  }

  // Validate jurisdiction has implementation
  if (config.jurisdiction === 'UK' || config.jurisdiction === 'EU') {
    return err(
      new Error(
        `Jurisdiction '${config.jurisdiction}' tax rules not yet implemented. Currently supported: CA, US. Coming soon: UK, EU`
      )
    );
  }

  // Validate date range
  if (config.startDate && config.endDate && config.startDate >= config.endDate) {
    return err(new Error('Start date must be before end date'));
  }

  return ok();
}
