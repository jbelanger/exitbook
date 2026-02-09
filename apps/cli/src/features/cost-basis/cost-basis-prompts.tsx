import { getDefaultDateRange } from '@exitbook/accounting';
import type { FiatCurrency } from '@exitbook/accounting';
import { Box, Text, useInput } from 'ink';
import { render } from 'ink';
import React, { useState, type FC } from 'react';

import { ConfirmPrompt } from '../../ui/shared/ConfirmPrompt.js';
import { SelectPrompt, type SelectOption } from '../../ui/shared/SelectPrompt.js';
import { TextPrompt } from '../../ui/shared/TextPrompt.js';

import type { CostBasisConfigWithDates, CostBasisHandlerParams } from './cost-basis-utils.js';

type Jurisdiction = 'CA' | 'US';
type Method = 'fifo' | 'lifo' | 'average-cost';

/** Steps in the cost basis prompt flow */
type PromptStep =
  | 'jurisdiction'
  | 'method'
  | 'cra-warning'
  | 'tax-year'
  | 'currency'
  | 'use-custom-dates'
  | 'start-date'
  | 'end-date'
  | 'confirm';

/** Collected answers as we progress through steps */
interface PromptAnswers {
  jurisdiction?: Jurisdiction | undefined;
  method?: Method | undefined;
  taxYear?: number | undefined;
  currency?: FiatCurrency | undefined;
  useCustomDates?: boolean | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

// ─── Option builders ─────────────────────────────────────────────────────────

const jurisdictionOptions: SelectOption[] = [
  { label: 'Canada (CA)', value: 'CA' },
  { label: 'United States (US)', value: 'US' },
  { label: 'United Kingdom (UK) - coming soon', value: 'UK', hint: 'Not yet implemented', disabled: true },
  { label: 'European Union (EU) - coming soon', value: 'EU', hint: 'Not yet implemented', disabled: true },
];

function buildMethodOptions(jurisdiction: Jurisdiction): SelectOption[] {
  const options: SelectOption[] = [
    {
      label: 'FIFO (First In, First Out)',
      value: 'fifo',
      ...(jurisdiction === 'CA' ? { hint: 'Not CRA-compliant for identical properties' } : {}),
    },
    {
      label: 'LIFO (Last In, First Out)',
      value: 'lifo',
      ...(jurisdiction === 'CA' ? { hint: 'Not CRA-compliant for identical properties' } : {}),
    },
  ];

  if (jurisdiction === 'CA') {
    options.push({
      label: 'Average Cost (ACB)',
      value: 'average-cost',
      hint: 'Canadian Adjusted Cost Base - ACB adjustment for denied losses not automated',
    });
  }

  options.push({
    label: 'Specific Lot Identification (coming soon)',
    value: 'specific-id',
    hint: 'Not yet implemented',
    disabled: true,
  });

  return options;
}

const currencyOptions: SelectOption[] = [
  { label: 'US Dollar (USD)', value: 'USD' },
  { label: 'Canadian Dollar (CAD)', value: 'CAD' },
  { label: 'Euro (EUR)', value: 'EUR' },
  { label: 'British Pound (GBP)', value: 'GBP' },
];

// ─── CRA Warning component ──────────────────────────────────────────────────

interface CraWarningProps {
  method: string;
  onContinue: () => void;
  onCancel: () => void;
}

const CraWarning: FC<CraWarningProps> = ({ method, onContinue, onCancel }) => {
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.return) {
      onContinue();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="yellow">{'  '}Tax Compliance Warning</Text>
      <Text>{'  '}CRA generally requires Average Cost (ACB) for identical properties</Text>
      <Text>
        {'  '}like cryptocurrencies. Using {method.toUpperCase()} may not be compliant
      </Text>
      <Text>{'  '}with Canadian tax regulations.</Text>
      <Text>{'  '}Consult a tax professional to determine the appropriate method.</Text>
      <Text dimColor>{'  '}Press Enter to continue...</Text>
    </Box>
  );
};

// ─── Main prompt app ─────────────────────────────────────────────────────────

interface CostBasisPromptAppProps {
  onComplete: (params: CostBasisHandlerParams) => void;
  onCancel: () => void;
}

const CostBasisPromptApp: FC<CostBasisPromptAppProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<PromptStep>('jurisdiction');
  const [answers, setAnswers] = useState<PromptAnswers>({});

  const currentYear = new Date().getUTCFullYear();

  // Step transitions
  const handleJurisdiction = (value: string): void => {
    const jurisdiction = value as Jurisdiction;
    setAnswers((prev) => ({ ...prev, jurisdiction }));
    setStep('method');
  };

  const handleMethod = (value: string): void => {
    const method = value as Method;
    setAnswers((prev) => ({ ...prev, method }));
    // Show CRA warning for CA + non-ACB
    if (answers.jurisdiction === 'CA' && (method === 'fifo' || method === 'lifo')) {
      setStep('cra-warning');
    } else {
      setStep('tax-year');
    }
  };

  const handleCraWarningContinue = (): void => {
    setStep('tax-year');
  };

  const handleTaxYear = (value: string): void => {
    const taxYear = parseInt(value, 10);
    setAnswers((prev) => ({ ...prev, taxYear }));
    setStep('currency');
  };

  const handleCurrency = (value: string): void => {
    setAnswers((prev) => ({ ...prev, currency: value as FiatCurrency }));
    setStep('use-custom-dates');
  };

  const handleUseCustomDates = (value: boolean): void => {
    setAnswers((prev) => ({ ...prev, useCustomDates: value }));
    if (value) {
      setStep('start-date');
    } else {
      setStep('confirm');
    }
  };

  const handleStartDate = (value: string): void => {
    setAnswers((prev) => ({ ...prev, startDate: value }));
    setStep('end-date');
  };

  const handleEndDate = (value: string): void => {
    setAnswers((prev) => ({ ...prev, endDate: value }));
    setStep('confirm');
  };

  const handleConfirm = (value: boolean): void => {
    if (!value) {
      onCancel();
      return;
    }

    const { jurisdiction, method, taxYear, currency, useCustomDates, startDate, endDate } = answers;

    let start: Date;
    let end: Date;

    if (useCustomDates && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const defaultRange = getDefaultDateRange(taxYear!, jurisdiction!);
      start = defaultRange.startDate;
      end = defaultRange.endDate;
    }

    const config: CostBasisConfigWithDates = {
      method: method!,
      jurisdiction: jurisdiction!,
      taxYear: taxYear!,
      currency: currency!,
      startDate: start,
      endDate: end,
    };

    onComplete({ config });
  };

  const defaultCurrency = answers.jurisdiction === 'CA' ? 'CAD' : 'USD';

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text bold>exitbook cost-basis</Text>
      <Text> </Text>

      {step === 'jurisdiction' && (
        <SelectPrompt
          message="Select tax jurisdiction:"
          options={jurisdictionOptions}
          initialValue="CA"
          onSubmit={handleJurisdiction}
          onCancel={onCancel}
        />
      )}

      {step === 'method' && (
        <SelectPrompt
          message="Select cost basis calculation method:"
          options={buildMethodOptions(answers.jurisdiction!)}
          initialValue="fifo"
          onSubmit={handleMethod}
          onCancel={onCancel}
        />
      )}

      {step === 'cra-warning' && (
        <CraWarning
          method={answers.method!}
          onContinue={handleCraWarningContinue}
          onCancel={onCancel}
        />
      )}

      {step === 'tax-year' && (
        <TextPrompt
          message="Enter tax year:"
          placeholder={String(currentYear - 1)}
          validate={(value: string) => {
            if (!value) return 'Tax year is required';
            const year = parseInt(value, 10);
            if (isNaN(year)) return 'Must be a valid year (e.g., 2024)';
            if (year < 2000 || year > 2100) return 'Year must be between 2000 and 2100';
          }}
          onSubmit={handleTaxYear}
          onCancel={onCancel}
        />
      )}

      {step === 'currency' && (
        <SelectPrompt
          message="Select fiat currency for cost basis:"
          options={currencyOptions}
          initialValue={defaultCurrency}
          onSubmit={handleCurrency}
          onCancel={onCancel}
        />
      )}

      {step === 'use-custom-dates' && (
        <ConfirmPrompt
          message="Use custom date range? (default: full tax year)"
          initialValue={false}
          onSubmit={handleUseCustomDates}
          onCancel={onCancel}
        />
      )}

      {step === 'start-date' && (
        <TextPrompt
          message="Enter start date (YYYY-MM-DD):"
          placeholder={`${answers.taxYear}-01-01`}
          validate={(value: string) => {
            if (!value) return 'Start date is required';
            const date = new Date(value);
            if (isNaN(date.getTime())) return 'Invalid date format. Use YYYY-MM-DD';
          }}
          onSubmit={handleStartDate}
          onCancel={onCancel}
        />
      )}

      {step === 'end-date' && (
        <TextPrompt
          message="Enter end date (YYYY-MM-DD):"
          placeholder={`${answers.taxYear}-12-31`}
          validate={(value: string) => {
            if (!value) return 'End date is required';
            const date = new Date(value);
            if (isNaN(date.getTime())) return 'Invalid date format. Use YYYY-MM-DD';
            if (answers.startDate) {
              const start = new Date(answers.startDate);
              if (date <= start) return 'End date must be after start date';
            }
          }}
          onSubmit={handleEndDate}
          onCancel={onCancel}
        />
      )}

      {step === 'confirm' && (
        <ConfirmPrompt
          message="Start cost basis calculation?"
          initialValue={true}
          onSubmit={handleConfirm}
          onCancel={onCancel}
        />
      )}
    </Box>
  );
};

/**
 * Prompt user for cost basis parameters in interactive mode using Ink.
 * Returns null if the user cancels.
 */
export async function promptForCostBasisParams(): Promise<CostBasisHandlerParams | null> {
  return new Promise<CostBasisHandlerParams | null>((resolve) => {
    const { unmount } = render(
      React.createElement(CostBasisPromptApp, {
        onComplete: (params: CostBasisHandlerParams) => {
          unmount();
          resolve(params);
        },
        onCancel: () => {
          unmount();
          resolve(null);
        },
      })
    );
  });
}
