import {
  buildCostBasisFilingFacts,
  getDefaultCostBasisMethodForJurisdiction,
  type CostBasisJurisdiction,
} from '@exitbook/accounting';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../../shared/cli-error.js';
import { renderApp, runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { unwrapResult } from '../../shared/result-utils.js';
import { CostBasisCommandOptionsSchema } from '../../shared/schemas.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import { isJsonMode } from '../../shared/utils.js';
import { CostBasisApp } from '../view/cost-basis-view-components.jsx';
import {
  type CalculationContext,
  createCostBasisAssetState,
  createCostBasisTimelineState,
} from '../view/cost-basis-view-state.js';
import {
  buildCanadaAssetCostBasisItems,
  buildStandardAssetCostBasisItems,
  buildSummaryTotalsFromAssetItems,
  sortAssetsByAbsGainLoss,
} from '../view/cost-basis-view-utils.js';

import { registerCostBasisExportCommand } from './cost-basis-export.js';
import type { CostBasisWorkflowResult, CostBasisInput } from './cost-basis-handler.js';
import { createCostBasisHandler } from './cost-basis-handler.js';
import { promptForCostBasisParams } from './cost-basis-prompts.jsx';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';

const logger = getLogger('cost-basis');

/**
 * Command options (validated at CLI boundary).
 */
type CommandOptions = z.infer<typeof CostBasisCommandOptionsSchema>;

/**
 * Cost basis command result data for JSON output.
 */
interface CostBasisCommandResult {
  calculationId: string;
  method: string;
  jurisdiction: string;
  taxYear: number;
  currency: string;
  dateRange: {
    endDate: string;
    startDate: string;
  };
  summary: {
    assetsProcessed: string[];
    disposalsProcessed: number;
    longTermGainLoss?: string | undefined;
    lotsCreated: number;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
    transactionsProcessed: number;
  };
  assets: {
    asset: string;
    avgHoldingDays?: number | undefined;
    disposalCount: number;
    disposals: {
      acquisitionDate?: string | undefined;
      acquisitionTransactionId?: number | undefined;
      asset: string;
      costBasisPerUnit: string;
      date: string;
      disposalTransactionId: number;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      gainLoss: string;
      holdingPeriodDays?: number | undefined;
      id: string;
      isGain: boolean;
      proceedsPerUnit: string;
      quantityDisposed: string;
      sortTimestamp: string;
      taxableGainLoss?: string | undefined;
      taxTreatmentCategory?: string | undefined;
      totalCostBasis: string;
      totalProceeds: string;
      type: 'disposal';
    }[];
    isGain: boolean;
    longestHoldingDays?: number | undefined;
    longTermCount?: number | undefined;
    longTermGainLoss?: string | undefined;
    lotCount: number;
    lots: {
      asset: string;
      costBasisPerUnit: string;
      date: string;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      fxUnavailable?: true | undefined;
      id: string;
      lotId: string;
      originalCurrency?: string | undefined;
      quantity: string;
      remainingQuantity: string;
      sortTimestamp: string;
      status: string;
      totalCostBasis: string;
      transactionId: number;
      type: 'acquisition';
    }[];
    shortestHoldingDays?: number | undefined;
    shortTermCount?: number | undefined;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
    transferCount: number;
    transfers: {
      asset: string;
      costBasisPerUnit: string;
      date: string;
      direction: 'in' | 'internal' | 'out';
      feeAmount?: string | undefined;
      feeCurrency?: string | undefined;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      fxUnavailable?: true | undefined;
      id: string;
      marketValue?: string | undefined;
      originalCurrency?: string | undefined;
      quantity: string;
      sortTimestamp: string;
      sourceAcquisitionDate?: string | undefined;
      sourceLotId?: string | undefined;
      sourceTransactionId?: number | undefined;
      targetTransactionId?: number | undefined;
      totalCostBasis: string;
      type: 'transfer';
    }[];
  }[];
}

interface CostBasisPresentationModel {
  assetItems: ReturnType<typeof sortAssetsByAbsGainLoss>;
  context: CalculationContext;
  summary: CostBasisCommandResult['summary'];
}

/**
 * Register the cost-basis command.
 */
export function registerCostBasisCommand(program: Command, registry: AdapterRegistry): void {
  const costBasisCommand = program
    .command('cost-basis')
    .description('Calculate cost basis and capital gains/losses for tax reporting')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost (CA defaults to ACB)')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US, UK, EU')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--fiat-currency <currency>', 'Fiat currency for cost basis: USD, CAD, EUR, GBP (defaults by jurisdiction)')
    .option('--start-date <date>', 'Custom start date (YYYY-MM-DD, requires --end-date)')
    .option('--end-date <date>', 'Custom end date (YYYY-MM-DD, requires --start-date)')
    .option('--asset <symbol>', 'Filter to specific asset (lands on asset history timeline)')
    .option('--refresh', 'Force recomputation and replace the latest stored snapshot for this scope')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeCostBasisCommand(rawOptions, registry));

  registerCostBasisExportCommand(costBasisCommand, registry);
}

async function executeCostBasisCommand(rawOptions: unknown, registry: AdapterRegistry): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const parseResult = CostBasisCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'cost-basis',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
    return;
  }

  const options = parseResult.data;

  if (options.json) {
    await executeCostBasisCalculateJSON(options, registry);
  } else {
    await executeCostBasisCalculateTUI(options, registry);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeCostBasisCalculateJSON(options: CommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    const params = unwrapResult(buildCostBasisInputFromFlags(options));

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createCostBasisHandler(ctx, database, { isJsonMode: true, params, registry });

      if (handlerResult.isErr()) {
        displayCliError('cost-basis', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const handler = handlerResult.value;
      const result = await handler.execute(params, { refresh: options.refresh });

      if (result.isErr()) {
        displayCliError('cost-basis', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputCostBasisJSON(result.value);
    });
  } catch (error) {
    displayCliError(
      'cost-basis',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

function outputCostBasisJSON(costBasisResult: CostBasisWorkflowResult): void {
  const presentation = buildPresentationModel(costBasisResult);

  const resultData: CostBasisCommandResult = {
    calculationId: presentation.context.calculationId,
    method: presentation.context.method,
    jurisdiction: presentation.context.jurisdiction,
    taxYear: presentation.context.taxYear,
    currency: presentation.context.currency,
    dateRange: presentation.context.dateRange,
    summary: presentation.summary,
    assets: presentation.assetItems,
  };

  outputSuccess('cost-basis', resultData);
}

// ─── TUI: Calculate Mode ─────────────────────────────────────────────────────

async function executeCostBasisCalculateTUI(options: CommandOptions, registry: AdapterRegistry): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();

      // Step 1: Resolve params via interactive prompts or CLI flags
      let params: CostBasisInput;
      const defaultMethodForJurisdiction = options.jurisdiction
        ? getDefaultCostBasisMethodForJurisdiction(options.jurisdiction as CostBasisJurisdiction)
        : undefined;
      const needsPrompt =
        !options.jurisdiction || !options.taxYear || (!options.method && !defaultMethodForJurisdiction);

      if (needsPrompt) {
        const promptResult = await promptForCostBasisParams(options);
        if (!promptResult) {
          console.log('\nCost basis calculation cancelled');
          return;
        }
        params = promptResult;
      } else {
        params = unwrapResult(buildCostBasisInputFromFlags(options));
      }

      // Step 2: Create handler (runs projection + linking + price enrichment prereqs)
      const handlerResult = await createCostBasisHandler(ctx, database, { isJsonMode: false, params, registry });
      if (handlerResult.isErr()) {
        displayCliError('cost-basis', handlerResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const handler = handlerResult.value;

      // Step 3: Calculate cost basis
      const spinner = createSpinner('Calculating cost basis...', false);
      const result = await handler.execute(params, { refresh: options.refresh });
      stopSpinner(spinner);

      if (result.isErr()) {
        displayCliError('cost-basis', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const costBasisResult = result.value;
      const presentation = buildPresentationModel(costBasisResult);

      const initialState = createCostBasisAssetState(
        presentation.context,
        presentation.assetItems,
        presentation.summary,
        {
          totalDisposals: presentation.summary.disposalsProcessed,
          totalLots: presentation.summary.lotsCreated,
        }
      );

      const finalState = resolveAssetFilter(initialState, options.asset);

      await ctx.closeDatabase();

      await renderApp((unmount) =>
        React.createElement(CostBasisApp, {
          initialState: finalState,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'cost-basis',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * If --asset is specified, find the matching asset and jump to its timeline.
 */
function resolveAssetFilter(
  state: ReturnType<typeof createCostBasisAssetState>,
  assetFilter?: string
): ReturnType<typeof createCostBasisAssetState> | ReturnType<typeof createCostBasisTimelineState> {
  if (!assetFilter) return state;

  const upperFilter = assetFilter.toUpperCase();
  const assetIndex = state.assets.findIndex((a) => a.asset.toUpperCase() === upperFilter);
  if (assetIndex < 0) {
    logger.warn({ asset: assetFilter }, 'Asset filter did not match any assets in the calculation');
    return state;
  }

  const assetItem = state.assets[assetIndex]!;
  return createCostBasisTimelineState(assetItem, state, assetIndex);
}

function buildPresentationModel(costBasisResult: CostBasisWorkflowResult): CostBasisPresentationModel {
  const filingFacts = unwrapResult(buildCostBasisFilingFacts({ artifact: costBasisResult }));

  if (costBasisResult.kind === 'standard-workflow') {
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts for standard-workflow artifact');
    }

    const { summary, report } = costBasisResult;
    const jurisdiction = filingFacts.jurisdiction;
    const currency = report?.displayCurrency ?? filingFacts.taxCurrency;
    const assetItems = sortAssetsByAbsGainLoss(buildStandardAssetCostBasisItems(filingFacts, report));
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems, {
      includeTaxTreatmentSplit: jurisdiction === 'US',
    });

    return {
      assetItems,
      context: {
        calculationId: filingFacts.calculationId,
        method: filingFacts.method,
        jurisdiction,
        taxYear: filingFacts.taxYear,
        currency,
        dateRange: {
          startDate: summary.calculation.startDate?.toISOString().split('T')[0] ?? '',
          endDate: summary.calculation.endDate?.toISOString().split('T')[0] ?? '',
        },
      },
      summary: {
        lotsCreated: filingFacts.summary.acquisitionCount,
        disposalsProcessed: filingFacts.summary.dispositionCount,
        assetsProcessed: summary.assetsProcessed,
        transactionsProcessed: summary.calculation.transactionsProcessed,
        totalProceeds: summaryTotals.totalProceeds,
        totalCostBasis: summaryTotals.totalCostBasis,
        totalGainLoss: summaryTotals.totalGainLoss,
        totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
        ...(summaryTotals.shortTermGainLoss ? { shortTermGainLoss: summaryTotals.shortTermGainLoss } : {}),
        ...(summaryTotals.longTermGainLoss ? { longTermGainLoss: summaryTotals.longTermGainLoss } : {}),
      },
    };
  }

  if (filingFacts.kind !== 'canada') {
    throw new Error('Expected Canada filing facts for canada-workflow artifact');
  }

  const currency = costBasisResult.displayReport?.displayCurrency ?? filingFacts.taxCurrency;
  const assetItems = sortAssetsByAbsGainLoss(
    buildCanadaAssetCostBasisItems(filingFacts, costBasisResult.displayReport)
  );
  const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems);

  return {
    assetItems,
    context: {
      calculationId: filingFacts.calculationId,
      method: filingFacts.method,
      jurisdiction: filingFacts.jurisdiction,
      taxYear: filingFacts.taxYear,
      currency,
      dateRange: {
        startDate: costBasisResult.calculation.startDate.toISOString().split('T')[0] ?? '',
        endDate: costBasisResult.calculation.endDate.toISOString().split('T')[0] ?? '',
      },
    },
    summary: {
      lotsCreated: filingFacts.summary.acquisitionCount,
      disposalsProcessed: filingFacts.summary.dispositionCount,
      assetsProcessed: costBasisResult.calculation.assetsProcessed,
      transactionsProcessed: costBasisResult.calculation.transactionsProcessed,
      totalProceeds: summaryTotals.totalProceeds,
      totalCostBasis: summaryTotals.totalCostBasis,
      totalGainLoss: summaryTotals.totalGainLoss,
      totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
    },
  };
}
