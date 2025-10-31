import * as p from '@clack/prompts';
import type { CostBasisConfig } from '@exitbook/accounting';

import { handleCancellation, isCancelled } from '../shared/prompts.ts';

import type { CostBasisHandlerParams } from './cost-basis-utils.ts';

/**
 * Prompt user for cost basis parameters in interactive mode.
 */
export async function promptForCostBasisParams(): Promise<CostBasisHandlerParams> {
  // Prompt for calculation method
  const method = await p.select({
    message: 'Select cost basis calculation method:',
    options: [
      { label: 'FIFO (First In, First Out)', value: 'fifo' as const },
      { label: 'LIFO (Last In, First Out)', value: 'lifo' as const },
      {
        label: 'Specific Lot Identification (coming soon)',
        value: 'specific-id' as const,
        hint: 'Not yet implemented',
      },
      { label: 'Average Cost (coming soon)', value: 'average-cost' as const, hint: 'Not yet implemented' },
    ],
    initialValue: 'fifo' as const,
  });

  if (isCancelled(method)) {
    handleCancellation();
  }

  // Validate method is implemented
  if (method === 'specific-id' || method === 'average-cost') {
    p.cancel('Selected method is not yet implemented. Please choose FIFO or LIFO.');
    process.exit(0);
  }

  // Prompt for jurisdiction
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

  // Prompt for tax year
  const currentYear = new Date().getFullYear();
  const taxYearInput = await p.text({
    message: 'Enter tax year:',
    placeholder: String(currentYear - 1),
    validate: (value: string) => {
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
  const defaultCurrency = jurisdiction === 'CA' ? 'CAD' : jurisdiction === 'US' ? 'USD' : 'EUR';

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

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (useCustomDates) {
    // Prompt for start date
    const startDateInput = await p.text({
      message: 'Enter start date (YYYY-MM-DD):',
      placeholder: `${taxYear}-01-01`,
      validate: (value: string) => {
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
      validate: (value: string) => {
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
  }

  // Build config object
  const config: CostBasisConfig = {
    method: method as CostBasisConfig['method'],
    jurisdiction: jurisdiction as CostBasisConfig['jurisdiction'],
    taxYear,
    currency: currency as CostBasisConfig['currency'],
    startDate,
    endDate,
  };

  return { config };
}
