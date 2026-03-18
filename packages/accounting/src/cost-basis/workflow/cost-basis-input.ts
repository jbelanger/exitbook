import { err, ok, type Result } from '@exitbook/core';

import {
  getDefaultCostBasisCurrencyForJurisdiction,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
} from '../jurisdictions/jurisdiction-configs.js';
import type { CostBasisConfig, FiatCurrency } from '../model/cost-basis-config.js';
import { getDefaultDateRange } from '../model/cost-basis-config.js';

export type ValidatedCostBasisConfig = CostBasisConfig & {
  endDate: Date;
  startDate: Date;
};

function validateMethod(method: string): Result<CostBasisConfig['method'], Error> {
  const validMethods = Array.from(
    new Set(
      listCostBasisJurisdictionCapabilities().flatMap((jurisdiction) =>
        jurisdiction.supportedMethods.map((methodCapability) => methodCapability.code)
      )
    )
  );

  if (!validMethods.includes(method as CostBasisConfig['method'])) {
    return err(new Error(`Invalid method '${method}'. Must be one of: ${validMethods.join(', ')}`));
  }

  return ok(method as CostBasisConfig['method']);
}

function getSelectableMethodsForJurisdiction(
  jurisdiction: CostBasisConfig['jurisdiction']
): CostBasisConfig['method'][] {
  return listCostBasisMethodCapabilitiesForJurisdiction(jurisdiction)
    .filter((capability) => capability.implemented)
    .map((capability) => capability.code);
}

function resolveMethod(
  method: string | undefined,
  jurisdiction: CostBasisConfig['jurisdiction']
): Result<CostBasisConfig['method'], Error> {
  if (method) {
    return validateMethod(method);
  }

  const selectableMethods = getSelectableMethodsForJurisdiction(jurisdiction);
  const [singleMethod] = selectableMethods;
  if (singleMethod && selectableMethods.length === 1) {
    return ok(singleMethod);
  }

  return err(
    new Error(
      `--method is required for jurisdiction '${jurisdiction}'. Available methods: ${selectableMethods.join(', ')}`
    )
  );
}

function validateJurisdiction(jurisdiction: string): Result<CostBasisConfig['jurisdiction'], Error> {
  const validJurisdictions = listCostBasisJurisdictionCapabilities().map((capability) => capability.code);
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

function validateFiatCurrency(currency: string): Result<FiatCurrency, Error> {
  const validCurrencies = SUPPORTED_COST_BASIS_FIAT_CURRENCIES;
  if (!validCurrencies.includes(currency as FiatCurrency)) {
    return err(new Error(`Invalid fiat currency '${currency}'. Must be one of: ${validCurrencies.join(', ')}`));
  }

  return ok(currency as FiatCurrency);
}

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

function parseDate(dateStr: string, fieldName: string): Result<Date, Error> {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return err(new Error(`Invalid ${fieldName} '${dateStr}'. Must be ISO date format (YYYY-MM-DD)`));
  }

  return ok(date);
}

export function buildCostBasisInput(fields: {
  endDate?: string | undefined;
  fiatCurrency?: string | undefined;
  jurisdiction: string;
  method?: string | undefined;
  startDate?: string | undefined;
  taxYear: number | string;
}): Result<ValidatedCostBasisConfig, Error> {
  const jurisdictionResult = validateJurisdiction(fields.jurisdiction);
  if (jurisdictionResult.isErr()) return err(jurisdictionResult.error);
  const jurisdiction = jurisdictionResult.value;

  const methodResult = resolveMethod(fields.method, jurisdiction);
  if (methodResult.isErr()) return err(methodResult.error);
  const method = methodResult.value;

  const combinationResult = validateMethodJurisdictionCombination(method, jurisdiction);
  if (combinationResult.isErr()) return err(combinationResult.error);

  const taxYearResult = validateTaxYear(fields.taxYear);
  if (taxYearResult.isErr()) return err(taxYearResult.error);
  const taxYear = taxYearResult.value;

  const currency = fields.fiatCurrency
    ? (() => {
        const currencyResult = validateFiatCurrency(fields.fiatCurrency);
        if (currencyResult.isErr()) return currencyResult;
        return ok(currencyResult.value);
      })()
    : ok(getDefaultCostBasisCurrencyForJurisdiction(jurisdiction));
  if (currency.isErr()) return err(currency.error);

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

  return ok({
    method,
    jurisdiction,
    taxYear,
    currency: currency.value,
    startDate,
    endDate,
  });
}

export function validateCostBasisInput(config: ValidatedCostBasisConfig): Result<void, Error> {
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
