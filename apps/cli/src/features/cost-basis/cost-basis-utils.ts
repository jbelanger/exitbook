import { buildCostBasisParams, type CostBasisInput } from '@exitbook/accounting';
import { err, type Result } from 'neverthrow';

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
 * Build cost basis parameters from CLI flags
 */
export function buildCostBasisParamsFromFlags(options: CostBasisCommandOptions): Result<CostBasisInput, Error> {
  if (!options.method) {
    return err(new Error('--method is required (fifo, lifo, specific-id, average-cost)'));
  }
  if (!options.jurisdiction) {
    return err(new Error('--jurisdiction is required (CA, US, UK, EU)'));
  }
  if (!options.taxYear) {
    return err(new Error('--tax-year is required (e.g., 2024)'));
  }

  return buildCostBasisParams({
    method: options.method,
    jurisdiction: options.jurisdiction,
    taxYear: options.taxYear,
    fiatCurrency: options.fiatCurrency,
    startDate: options.startDate,
    endDate: options.endDate,
  });
}
