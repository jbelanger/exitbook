import { buildCostBasisInput, type ValidatedCostBasisConfig } from '@exitbook/accounting/cost-basis';
import { err, type Result } from '@exitbook/foundation';

/**
 * CLI options for cost-basis command
 */
export interface CostBasisCommandOptions {
  asset?: string | undefined;
  endDate?: string | undefined;
  method?: string | undefined;
  jurisdiction?: string | undefined;
  taxYear?: string | number | undefined;
  fiatCurrency?: string | undefined;
  startDate?: string | undefined;
  refresh?: boolean | undefined;
  json?: boolean | undefined;
}

/**
 * Build cost basis input from CLI flags
 */
export function buildCostBasisInputFromFlags(
  options: CostBasisCommandOptions
): Result<ValidatedCostBasisConfig, Error> {
  if (!options.jurisdiction) {
    return err(new Error('--jurisdiction is required (CA, US, UK, EU)'));
  }
  if (!options.taxYear) {
    return err(new Error('--tax-year is required (e.g., 2024)'));
  }

  return buildCostBasisInput({
    endDate: options.endDate,
    method: options.method,
    jurisdiction: options.jurisdiction,
    taxYear: options.taxYear,
    fiatCurrency: options.fiatCurrency,
    startDate: options.startDate,
  });
}
