import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { unwrapResult } from '../shared/command-execution.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { CostBasisCommandOptionsSchema } from '../shared/schemas.js';
import { createSpinner, stopSpinner } from '../shared/spinner.js';
import { isJsonMode } from '../shared/utils.js';

import {
  CostBasisApp,
  buildAssetCostBasisItems,
  computeSummaryTotals,
  createCostBasisAssetState,
  createCostBasisTimelineState,
  sortAssetsByAbsGainLoss,
  type CalculationContext,
} from './components/index.js';
import type { CostBasisResult, CostBasisHandlerParams } from './cost-basis-handler.js';
import { CostBasisHandler } from './cost-basis-handler.js';
import { ensureLinks, ensurePrices } from './cost-basis-prereqs.js';
import { promptForCostBasisParams } from './cost-basis-prompts.js';
import { buildCostBasisParamsFromFlags } from './cost-basis-utils.js';

const logger = getLogger('cost-basis');

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof CostBasisCommandOptionsSchema>;

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
    avgHoldingDays: number;
    disposalCount: number;
    disposals: {
      acquisitionDate: string;
      acquisitionTransactionId: number;
      asset: string;
      costBasisPerUnit: string;
      date: string;
      disposalTransactionId: number;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      gainLoss: string;
      holdingPeriodDays: number;
      id: string;
      isGain: boolean;
      proceedsPerUnit: string;
      quantityDisposed: string;
      sortTimestamp: string;
      taxTreatmentCategory?: string | undefined;
      totalCostBasis: string;
      totalProceeds: string;
      type: 'disposal';
    }[];
    isGain: boolean;
    longestHoldingDays: number;
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
    shortestHoldingDays: number;
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
      feeUsdValue?: string | undefined;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      fxUnavailable?: true | undefined;
      id: string;
      originalCurrency?: string | undefined;
      quantity: string;
      sortTimestamp: string;
      sourceAcquisitionDate: string;
      sourceLotId: string;
      sourceTransactionId: number;
      targetTransactionId: number;
      totalCostBasis: string;
      type: 'transfer';
    }[];
  }[];
  missingPricesWarning?: string | undefined;
  errors?: { asset: string; error: string }[] | undefined;
}

/**
 * Register the cost-basis command.
 */
export function registerCostBasisCommand(program: Command): void {
  program
    .command('cost-basis')
    .description('Calculate cost basis and capital gains/losses for tax reporting')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US, UK, EU')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--fiat-currency <currency>', 'Fiat currency for cost basis: USD, CAD, EUR, GBP')
    .option('--start-date <date>', 'Custom start date (YYYY-MM-DD, requires --end-date)')
    .option('--end-date <date>', 'Custom end date (YYYY-MM-DD, requires --start-date)')
    .option('--asset <symbol>', 'Filter to specific asset (lands on asset history timeline)')
    .option('--json', 'Output results in JSON format')
    .action(executeCostBasisCommand);
}

async function executeCostBasisCommand(rawOptions: unknown): Promise<void> {
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
    await executeCostBasisCalculateJSON(options);
  } else {
    await executeCostBasisCalculateTUI(options);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeCostBasisCalculateJSON(options: CommandOptions): Promise<void> {
  try {
    const params = unwrapResult(buildCostBasisParamsFromFlags(options));

    await runCommand(async (ctx) => {
      const database = await ctx.database();

      // Auto-run prerequisites
      const linksResult = await ensureLinks(database, ctx.dataDir, ctx, true);
      if (linksResult.isErr()) {
        displayCliError('cost-basis', linksResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const pricesResult = await ensurePrices(
        database,
        params.config.startDate,
        params.config.endDate,
        params.config.currency,
        ctx,
        true
      );
      if (pricesResult.isErr()) {
        displayCliError('cost-basis', pricesResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const handler = new CostBasisHandler(database);
      const result = await handler.execute(params);

      if (result.isErr()) {
        displayCliError('cost-basis', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
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

function outputCostBasisJSON(costBasisResult: CostBasisResult): void {
  const { summary, missingPricesWarning, report, lots, disposals, lotTransfers } = costBasisResult;
  const currency = summary.calculation.config.currency;
  const jurisdiction = summary.calculation.config.jurisdiction;

  // Build detailed asset breakdown (same as TUI)
  const assetItems = buildAssetCostBasisItems(lots, disposals, lotTransfers, jurisdiction, currency, report);
  const sortedAssets = sortAssetsByAbsGainLoss(assetItems);
  const summaryTotals = computeSummaryTotals(sortedAssets, jurisdiction);

  const resultData: CostBasisCommandResult = {
    calculationId: summary.calculation.id,
    method: summary.calculation.config.method,
    jurisdiction,
    taxYear: summary.calculation.config.taxYear,
    currency,
    dateRange: {
      startDate: summary.calculation.startDate?.toISOString().split('T')[0] ?? '',
      endDate: summary.calculation.endDate?.toISOString().split('T')[0] ?? '',
    },
    summary: {
      lotsCreated: summary.lotsCreated,
      disposalsProcessed: summary.disposalsProcessed,
      assetsProcessed: summary.assetsProcessed,
      transactionsProcessed: summary.calculation.transactionsProcessed,
      totalProceeds: summaryTotals.totalProceeds,
      totalCostBasis: summaryTotals.totalCostBasis,
      totalGainLoss: summaryTotals.totalGainLoss,
      totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
      ...(summaryTotals.shortTermGainLoss ? { shortTermGainLoss: summaryTotals.shortTermGainLoss } : {}),
      ...(summaryTotals.longTermGainLoss ? { longTermGainLoss: summaryTotals.longTermGainLoss } : {}),
    },
    assets: sortedAssets,
    missingPricesWarning,
    ...(costBasisResult.errors.length > 0
      ? { errors: costBasisResult.errors.map((e) => ({ asset: e.assetSymbol, error: e.error })) }
      : {}),
  };

  outputSuccess('cost-basis', resultData);
}

// ─── TUI: Calculate Mode ─────────────────────────────────────────────────────

async function executeCostBasisCalculateTUI(options: CommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();

      // Step 1: Auto-run linking if stale (before prompts so DB is available)
      const linksResult = await ensureLinks(database, ctx.dataDir, ctx, false);
      if (linksResult.isErr()) {
        console.error(`\n\u26A0 Error: ${linksResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      // Step 2: Resolve params via interactive prompts or CLI flags
      let params: CostBasisHandlerParams;
      if (!options.method && !options.jurisdiction && !options.taxYear) {
        const promptResult = await promptForCostBasisParams();
        if (!promptResult) {
          console.log('\nCost basis calculation cancelled');
          return;
        }
        params = promptResult;
      } else {
        params = unwrapResult(buildCostBasisParamsFromFlags(options));
      }

      // Step 3: Auto-run price enrichment if missing (needs date range from params)
      const pricesResult = await ensurePrices(
        database,
        params.config.startDate,
        params.config.endDate,
        params.config.currency,
        ctx,
        false
      );
      if (pricesResult.isErr()) {
        console.error(`\n\u26A0 Error: ${pricesResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      // Step 4: Calculate cost basis
      const spinner = createSpinner('Calculating cost basis...', false);

      const handler = new CostBasisHandler(database);
      const result = await handler.execute(params);
      stopSpinner(spinner);

      if (result.isErr()) {
        console.error(`\n\u26A0 Error: ${result.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const costBasisResult = result.value;
      const { summary, missingPricesWarning, report, lots, disposals, lotTransfers } = costBasisResult;
      const calculation = summary.calculation;
      const currency = calculation.config.currency;
      const jurisdiction = calculation.config.jurisdiction;

      const assetItems = buildAssetCostBasisItems(lots, disposals, lotTransfers, jurisdiction, currency, report);
      const sortedAssets = sortAssetsByAbsGainLoss(assetItems);
      const summaryTotals = computeSummaryTotals(sortedAssets, jurisdiction);

      const context: CalculationContext = {
        calculationId: calculation.id,
        method: calculation.config.method,
        jurisdiction,
        taxYear: calculation.config.taxYear,
        currency,
        dateRange: {
          startDate: calculation.startDate?.toISOString().split('T')[0] ?? '',
          endDate: calculation.endDate?.toISOString().split('T')[0] ?? '',
        },
      };

      const calculationErrors =
        costBasisResult.errors.length > 0
          ? costBasisResult.errors.map((e) => ({ asset: e.assetSymbol, error: e.error }))
          : undefined;

      const initialState = createCostBasisAssetState(context, sortedAssets, summaryTotals, {
        totalDisposals: summary.disposalsProcessed,
        totalLots: summary.lotsCreated,
        missingPricesWarning,
        calculationErrors,
      });

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
    console.error('\n\u26A0 Error:', error instanceof Error ? error.message : String(error));
    process.exit(ExitCodes.GENERAL_ERROR);
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
