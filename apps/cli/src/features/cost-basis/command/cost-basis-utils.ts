import { buildCostBasisInput, type CostBasisInput } from '@exitbook/accounting';
import { err, type Result } from '@exitbook/core';

/**
 * CLI options for cost-basis command
 */
export interface CostBasisCommandOptions {
  asset?: string | undefined;
  method?: string | undefined;
  jurisdiction?: string | undefined;
  taxYear?: string | number | undefined;
  fiatCurrency?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  refresh?: boolean | undefined;
  json?: boolean | undefined;
}

/**
 * Build cost basis input from CLI flags
 */
export function buildCostBasisInputFromFlags(options: CostBasisCommandOptions): Result<CostBasisInput, Error> {
  if (!options.method) {
    return err(new Error('--method is required (fifo, lifo, specific-id, average-cost)'));
  }
  if (!options.jurisdiction) {
    return err(new Error('--jurisdiction is required (CA, US, UK, EU)'));
  }
  if (!options.taxYear) {
    return err(new Error('--tax-year is required (e.g., 2024)'));
  }

  return buildCostBasisInput({
    method: options.method,
    jurisdiction: options.jurisdiction,
    taxYear: options.taxYear,
    fiatCurrency: options.fiatCurrency,
    startDate: options.startDate,
    endDate: options.endDate,
  });
}
