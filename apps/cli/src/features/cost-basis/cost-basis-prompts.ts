import * as p from '@clack/prompts';
import { getDefaultDateRange } from '@exitbook/accounting';

import { handleCancellation, isCancelled } from '../shared/prompts.js';

import type { CostBasisConfigWithDates, CostBasisHandlerParams } from './cost-basis-utils.js';

/**
 * Prompt user for cost basis parameters in interactive mode.
 */
export async function promptForCostBasisParams(): Promise<CostBasisHandlerParams> {
  // Prompt for jurisdiction FIRST (needed for method options)
  const jurisdiction = await p.select({
    message: 'Select tax jurisdiction:',
    options: [
      { label: 'Canada (CA)', value: 'CA' as const },
      { label: 'United States (US)', value: 'US' as const },
      { label: 'United Kingdom (UK) - coming soon', value: 'UK' as const, hint: 'Not yet implemented' },
      { label: 'European Union (EU) - coming soon', value: 'EU' as const, hint: 'Not yet implemented' },
    ],
    initialValue: 'CA' as const,
  });

  if (isCancelled(jurisdiction)) {
    handleCancellation();
  }

  // Validate jurisdiction is implemented
  if (jurisdiction === 'UK' || jurisdiction === 'EU') {
    p.cancel('Selected jurisdiction is not yet implemented. Please choose CA or US.');
    process.exit(0);
  }

  // Type narrowing: jurisdiction is now 'CA' | 'US'
  const validJurisdiction = jurisdiction;

  // Build method options based on jurisdiction (let TypeScript infer discriminated union type)
  const methodOptions = [];

  // Add FIFO option with CA-specific hint
  methodOptions.push({
    label: 'FIFO (First In, First Out)',
    value: 'fifo' as const,
    ...(validJurisdiction === 'CA' ? { hint: 'Not CRA-compliant for identical properties' } : {}),
  });

  // Add LIFO option with CA-specific hint
  methodOptions.push({
    label: 'LIFO (Last In, First Out)',
    value: 'lifo' as const,
    ...(validJurisdiction === 'CA' ? { hint: 'Not CRA-compliant for identical properties' } : {}),
  });

  // Add Average Cost only for Canada
  if (validJurisdiction === 'CA') {
    methodOptions.push({
      label: 'Average Cost (ACB)',
      value: 'average-cost' as const,
      hint: 'Canadian Adjusted Cost Base - ACB adjustment for denied losses not automated',
    });
  }

  // Add Specific ID option (not yet implemented)
  methodOptions.push({
    label: 'Specific Lot Identification (coming soon)',
    value: 'specific-id' as const,
    hint: 'Not yet implemented',
  });

  // Prompt for calculation method
  const method = await p.select({
    message: 'Select cost basis calculation method:',
    options: methodOptions,
    initialValue: 'fifo' as const,
  });

  if (isCancelled(method)) {
    handleCancellation();
  }

  // Validate method is implemented
  if (method === 'specific-id') {
    p.cancel('Selected method is not yet implemented. Please choose FIFO, LIFO, or Average Cost (CA only).');
    process.exit(0);
  }

  // Warn about CRA compliance for Canadian users selecting non-ACB methods
  if (validJurisdiction === 'CA' && (method === 'fifo' || method === 'lifo')) {
    p.note(
      `⚠️  CRA generally requires Average Cost (ACB) for identical properties like cryptocurrencies.\n` +
        `Using ${method.toUpperCase()} may not be compliant with Canadian tax regulations.\n` +
        `Consult a tax professional to determine the appropriate method for your situation.`,
      'Tax Compliance Warning'
    );
  }

  // Prompt for tax year
  const currentYear = new Date().getUTCFullYear();
  const taxYearInput = await p.text({
    message: 'Enter tax year:',
    placeholder: String(currentYear - 1),
    validate: (value: string | undefined) => {
      if (!value) return 'Tax year is required';
      const year = parseInt(value, 10);
      if (isNaN(year)) return 'Must be a valid year (e.g., 2024)';
      if (year < 2000 || year > 2100) return 'Year must be between 2000 and 2100';
    },
  });

  if (isCancelled(taxYearInput)) {
    handleCancellation();
  }

  const taxYear = parseInt(taxYearInput, 10);

  // Prompt for fiat currency with jurisdiction-appropriate default
  const defaultCurrency = validJurisdiction === 'CA' ? 'CAD' : 'USD';

  const currency = await p.select({
    message: 'Select fiat currency for cost basis:',
    options: [
      { label: 'US Dollar (USD)', value: 'USD' as const },
      { label: 'Canadian Dollar (CAD)', value: 'CAD' as const },
      { label: 'Euro (EUR)', value: 'EUR' as const },
      { label: 'British Pound (GBP)', value: 'GBP' as const },
    ],
    initialValue: defaultCurrency,
  });

  if (isCancelled(currency)) {
    handleCancellation();
  }

  // Ask if user wants custom date range
  const useCustomDates = await p.confirm({
    message: 'Use custom date range? (default: full tax year)',
    initialValue: false,
  });

  if (isCancelled(useCustomDates)) {
    handleCancellation();
  }

  let startDate: Date;
  let endDate: Date;

  if (useCustomDates) {
    // Prompt for start date
    const startDateInput = await p.text({
      message: 'Enter start date (YYYY-MM-DD):',
      placeholder: `${taxYear}-01-01`,
      validate: (value: string | undefined) => {
        if (!value) return 'Start date is required';
        const date = new Date(value);
        if (isNaN(date.getTime())) return 'Invalid date format. Use YYYY-MM-DD';
      },
    });

    if (isCancelled(startDateInput)) {
      handleCancellation();
    }

    // Prompt for end date
    const endDateInput = await p.text({
      message: 'Enter end date (YYYY-MM-DD):',
      placeholder: `${taxYear}-12-31`,
      validate: (value: string | undefined) => {
        if (!value) return 'End date is required';
        const date = new Date(value);
        if (isNaN(date.getTime())) return 'Invalid date format. Use YYYY-MM-DD';
        const start = new Date(startDateInput);
        if (date <= start) return 'End date must be after start date';
      },
    });

    if (isCancelled(endDateInput)) {
      handleCancellation();
    }

    startDate = new Date(startDateInput);
    endDate = new Date(endDateInput);
  } else {
    // Use default date range for jurisdiction (same as flag path)
    const defaultRange = getDefaultDateRange(taxYear, validJurisdiction);
    startDate = defaultRange.startDate;
    endDate = defaultRange.endDate;
  }

  // Build config object with required dates
  const config: CostBasisConfigWithDates = {
    method: method as CostBasisConfigWithDates['method'],
    jurisdiction: validJurisdiction,
    taxYear,
    currency: currency as CostBasisConfigWithDates['currency'],
    startDate,
    endDate,
  };

  return { config };
}
