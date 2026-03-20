import {
  buildCostBasisInput,
  getDefaultCostBasisMethodForJurisdiction,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  type ValidatedCostBasisConfig,
  type CostBasisJurisdiction,
  type CostBasisMethod,
} from '@exitbook/accounting';
import { Box, render, Text } from 'ink';
import React, { useState, type FC } from 'react';

import { SelectPrompt, type SelectOption } from '../../../ui/shared/select-prompt.jsx';
import { TextPrompt } from '../../../ui/shared/text-prompt.jsx';

/** Steps in the cost basis prompt flow */
type PromptStep = 'jurisdiction' | 'method' | 'tax-year';

/** Collected answers as we progress through steps */
interface PromptAnswers {
  jurisdiction?: CostBasisJurisdiction | undefined;
  method?: CostBasisMethod | undefined;
  taxYear?: number | undefined;
}

interface PromptSeedValues {
  endDate?: string | undefined;
  fiatCurrency?: string | undefined;
  jurisdiction?: string | undefined;
  method?: string | undefined;
  startDate?: string | undefined;
  taxYear?: number | string | undefined;
}

// ─── Option builders ─────────────────────────────────────────────────────────

const jurisdictionOptions: SelectOption[] = listCostBasisJurisdictionCapabilities().map((capability) => ({
  label: capability.costBasisImplemented ? capability.label : `${capability.label} - coming soon`,
  value: capability.code,
  hint: capability.costBasisImplemented ? undefined : 'Not yet implemented',
  disabled: !capability.costBasisImplemented,
}));

function buildMethodOptions(jurisdiction: CostBasisJurisdiction): SelectOption[] {
  const result = listCostBasisMethodCapabilitiesForJurisdiction(jurisdiction);
  if (result.isErr()) return [];
  return result.value.map((capability) => ({
    label: capability.implemented ? capability.label : `${capability.label} (coming soon)`,
    value: capability.code,
    hint: capability.implemented ? capability.description : 'Not yet implemented',
    disabled: !capability.implemented,
  }));
}

function getDefaultMethod(jurisdiction: CostBasisJurisdiction): CostBasisMethod | undefined {
  const result = getDefaultCostBasisMethodForJurisdiction(jurisdiction);
  return result.isOk() ? result.value : undefined;
}

function isJurisdiction(value: string | undefined): value is CostBasisJurisdiction {
  return listCostBasisJurisdictionCapabilities().some((capability) => capability.code === value);
}

function isMethod(value: string | undefined): value is CostBasisMethod {
  if (!value) {
    return false;
  }

  return listCostBasisJurisdictionCapabilities().some((jurisdiction) => {
    const result = listCostBasisMethodCapabilitiesForJurisdiction(jurisdiction.code);
    return result.isOk() && result.value.some((capability) => capability.code === value);
  });
}

function getInitialAnswers(initialValues: PromptSeedValues): PromptAnswers {
  const jurisdiction = isJurisdiction(initialValues.jurisdiction) ? initialValues.jurisdiction : undefined;
  const method = isMethod(initialValues.method) ? initialValues.method : undefined;
  const taxYear =
    typeof initialValues.taxYear === 'number'
      ? initialValues.taxYear
      : typeof initialValues.taxYear === 'string'
        ? Number.parseInt(initialValues.taxYear, 10)
        : undefined;

  return {
    jurisdiction,
    method: (jurisdiction ? getDefaultMethod(jurisdiction) : undefined) ?? method,
    taxYear: Number.isNaN(taxYear) ? undefined : taxYear,
  };
}

function getPromptStep(answers: PromptAnswers): PromptStep {
  if (!answers.jurisdiction) {
    return 'jurisdiction';
  }

  if (!answers.method) {
    return 'method';
  }

  return 'tax-year';
}

// ─── Main prompt app ─────────────────────────────────────────────────────────

interface CostBasisPromptAppProps {
  initialValues: PromptSeedValues;
  onComplete: (params: ValidatedCostBasisConfig) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
}

const CostBasisPromptApp: FC<CostBasisPromptAppProps> = ({ initialValues, onComplete, onCancel, onError }) => {
  const [answers, setAnswers] = useState<PromptAnswers>(() => getInitialAnswers(initialValues));
  const [step, setStep] = useState<PromptStep>(() => getPromptStep(getInitialAnswers(initialValues)));

  const currentYear = new Date().getUTCFullYear();

  // Step transitions
  const handleJurisdiction = (value: string): void => {
    const jurisdiction = value as CostBasisJurisdiction;
    const method = getDefaultMethod(jurisdiction);
    setAnswers((prev) => ({ ...prev, jurisdiction, method }));
    setStep(method ? 'tax-year' : 'method');
  };

  const handleMethod = (value: string): void => {
    const method = value as CostBasisMethod;
    setAnswers((prev) => ({ ...prev, method }));
    setStep('tax-year');
  };

  const handleTaxYear = (value: string): void => {
    const taxYear = parseInt(value, 10);
    const nextAnswers = { ...answers, taxYear };
    setAnswers(nextAnswers);

    const inputResult = buildCostBasisInput({
      jurisdiction: nextAnswers.jurisdiction!,
      method: nextAnswers.method,
      taxYear: nextAnswers.taxYear,
      fiatCurrency: initialValues.fiatCurrency,
      startDate: initialValues.startDate,
      endDate: initialValues.endDate,
    });

    if (inputResult.isErr()) {
      onError(inputResult.error);
      return;
    }

    onComplete(inputResult.value);
  };

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text bold>exitbook cost-basis</Text>
      <Text dimColor>
        Uses the full tax year and the jurisdiction default fiat currency unless flags override them.
      </Text>
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
          initialValue={getDefaultMethod(answers.jurisdiction!) ?? 'fifo'}
          onSubmit={handleMethod}
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
    </Box>
  );
};

/**
 * Prompt user for cost basis parameters in interactive mode using Ink.
 * Returns null if the user cancels.
 */
export function promptForCostBasisParams(
  initialValues: PromptSeedValues = {}
): Promise<ValidatedCostBasisConfig | null> {
  return new Promise<ValidatedCostBasisConfig | null>((resolve, reject) => {
    const { unmount } = render(
      React.createElement(CostBasisPromptApp, {
        initialValues,
        onComplete: (params: ValidatedCostBasisConfig) => {
          unmount();
          resolve(params);
        },
        onCancel: () => {
          unmount();
          resolve(null);
        },
        onError: (error: Error) => {
          unmount();
          reject(error);
        },
      })
    );
  });
}
