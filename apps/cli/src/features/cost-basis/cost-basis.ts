import path from 'node:path';

import type { CostBasisReport } from '@exitbook/accounting';
import {
  CostBasisReportGenerator,
  CostBasisRepository,
  LotTransferRepository,
  StandardFxRateProvider,
  TransactionLinkRepository,
} from '@exitbook/accounting';
import { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { createPriceProviderManager } from '@exitbook/price-providers';
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
  createCostBasisDisposalState,
  sortAssetsByAbsGainLoss,
  type CalculationContext,
} from './components/index.js';
import type { CostBasisResult } from './cost-basis-handler.js';
import { CostBasisHandler } from './cost-basis-handler.js';
import { promptForCostBasisParams } from './cost-basis-prompts.js';
import { buildCostBasisParamsFromFlags, type CostBasisHandlerParams } from './cost-basis-utils.js';

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
      disposalDate: string;
      disposalTransactionId: number;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      gainLoss: string;
      holdingPeriodDays: number;
      id: string;
      isGain: boolean;
      proceedsPerUnit: string;
      quantityDisposed: string;
      taxTreatmentCategory?: string | undefined;
      totalCostBasis: string;
      totalProceeds: string;
    }[];
    isGain: boolean;
    longestHoldingDays: number;
    longTermCount?: number | undefined;
    longTermGainLoss?: string | undefined;
    shortestHoldingDays: number;
    shortTermCount?: number | undefined;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
  }[];
  missingPricesWarning?: string | undefined;
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
    .option('--calculation-id <id>', 'View a previous calculation (no recomputation)')
    .option('--asset <symbol>', 'Filter to specific asset (lands on disposal list)')
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
    if (options.calculationId) {
      await executeCostBasisViewJSON(options);
    } else {
      await executeCostBasisCalculateJSON(options);
    }
  } else if (options.calculationId) {
    await executeCostBasisViewTUI(options);
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
      const transactionRepo = new TransactionRepository(database);
      const linkRepo = new TransactionLinkRepository(database);
      const costBasisRepo = new CostBasisRepository(database);
      const lotTransferRepo = new LotTransferRepository(database);
      const handler = new CostBasisHandler(transactionRepo, linkRepo, costBasisRepo, lotTransferRepo);

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

async function executeCostBasisViewJSON(options: CommandOptions): Promise<void> {
  const calculationId = options.calculationId!;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const costBasisRepo = new CostBasisRepository(database);

      const calcResult = await costBasisRepo.findCalculationById(calculationId);
      if (calcResult.isErr()) {
        displayCliError('cost-basis', calcResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const calculation = calcResult.value;
      if (!calculation) {
        displayCliError(
          'cost-basis',
          new Error(`Calculation not found: ${calculationId}`),
          ExitCodes.GENERAL_ERROR,
          'json'
        );
        return;
      }

      if (calculation.status !== 'completed') {
        displayCliError(
          'cost-basis',
          new Error(`Calculation is not completed (status: ${calculation.status})`),
          ExitCodes.GENERAL_ERROR,
          'json'
        );
        return;
      }

      const currency = calculation.config.currency;
      const jurisdiction = calculation.config.jurisdiction;

      // Load lots and disposals for detailed breakdown
      const lotsResult = await costBasisRepo.findLotsByCalculationId(calculationId);
      const disposalsResult = await costBasisRepo.findDisposalsByCalculationId(calculationId);

      if (lotsResult.isErr()) {
        displayCliError('cost-basis', lotsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }
      if (disposalsResult.isErr()) {
        displayCliError('cost-basis', disposalsResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const lots = lotsResult.value;
      const disposals = disposalsResult.value;

      let report: CostBasisReport | undefined;
      if (currency !== 'USD') {
        const reportResult = await generateReport(costBasisRepo, calculationId, currency, ctx.dataDir);
        if (reportResult) {
          report = reportResult;
        }
      }

      // Build detailed asset breakdown (same as TUI)
      const assetItems = buildAssetCostBasisItems(lots, disposals, jurisdiction, currency, report);
      const sortedAssets = sortAssetsByAbsGainLoss(assetItems);
      const summaryTotals = computeSummaryTotals(sortedAssets, jurisdiction);

      const resultData: CostBasisCommandResult = {
        calculationId: calculation.id,
        method: calculation.config.method,
        jurisdiction,
        taxYear: calculation.config.taxYear,
        currency,
        dateRange: {
          startDate: calculation.startDate?.toISOString().split('T')[0] ?? '',
          endDate: calculation.endDate?.toISOString().split('T')[0] ?? '',
        },
        summary: {
          lotsCreated: calculation.lotsCreated,
          disposalsProcessed: calculation.disposalsProcessed,
          assetsProcessed: calculation.assetsProcessed,
          transactionsProcessed: calculation.transactionsProcessed,
          totalProceeds: summaryTotals.totalProceeds,
          totalCostBasis: summaryTotals.totalCostBasis,
          totalGainLoss: summaryTotals.totalGainLoss,
          totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
          ...(summaryTotals.shortTermGainLoss ? { shortTermGainLoss: summaryTotals.shortTermGainLoss } : {}),
          ...(summaryTotals.longTermGainLoss ? { longTermGainLoss: summaryTotals.longTermGainLoss } : {}),
        },
        assets: sortedAssets,
      };

      outputSuccess('cost-basis', resultData);
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
  const { summary, missingPricesWarning, report, lots, disposals } = costBasisResult;
  const currency = summary.calculation.config.currency;
  const jurisdiction = summary.calculation.config.jurisdiction;

  // Build detailed asset breakdown (same as TUI)
  const assetItems = buildAssetCostBasisItems(lots, disposals, jurisdiction, currency, report);
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
  };

  outputSuccess('cost-basis', resultData);
}

// ─── TUI: Calculate Mode ─────────────────────────────────────────────────────

async function executeCostBasisCalculateTUI(options: CommandOptions): Promise<void> {
  try {
    // Resolve params: interactive prompts or CLI flags
    let params: CostBasisHandlerParams;
    if (!options.method && !options.jurisdiction && !options.taxYear) {
      const result = await promptForCostBasisParams();
      if (!result) {
        console.log('\nCost basis calculation cancelled');
        return;
      }
      params = result;
    } else {
      params = unwrapResult(buildCostBasisParamsFromFlags(options));
    }

    const spinner = createSpinner('Calculating cost basis...', false);

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const transactionRepo = new TransactionRepository(database);
      const linkRepo = new TransactionLinkRepository(database);
      const costBasisRepo = new CostBasisRepository(database);
      const lotTransferRepo = new LotTransferRepository(database);
      const handler = new CostBasisHandler(transactionRepo, linkRepo, costBasisRepo, lotTransferRepo);

      const result = await handler.execute(params);
      stopSpinner(spinner);

      if (result.isErr()) {
        console.error(`\n\u26A0 Error: ${result.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const costBasisResult = result.value;
      const { summary, missingPricesWarning, report } = costBasisResult;
      const calculation = summary.calculation;
      const currency = calculation.config.currency;
      const jurisdiction = calculation.config.jurisdiction;

      const lotsResult = await costBasisRepo.findLotsByCalculationId(calculation.id);
      const disposalsResult = await costBasisRepo.findDisposalsByCalculationId(calculation.id);

      if (lotsResult.isErr() || disposalsResult.isErr()) {
        const error = lotsResult.isErr()
          ? lotsResult.error
          : disposalsResult.isErr()
            ? disposalsResult.error
            : new Error('Unknown');
        logger.error({ error }, 'Failed to load lots/disposals for TUI');
        console.error(`\n\u26A0 Error loading results: ${error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const lots = lotsResult.value;
      const disposals = disposalsResult.value;

      const assetItems = buildAssetCostBasisItems(lots, disposals, jurisdiction, currency, report);
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

      const initialState = createCostBasisAssetState(context, sortedAssets, summaryTotals, {
        totalDisposals: summary.disposalsProcessed,
        totalLots: summary.lotsCreated,
        missingPricesWarning,
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

// ─── TUI: View Mode (--calculation-id) ──────────────────────────────────────

async function executeCostBasisViewTUI(options: CommandOptions): Promise<void> {
  const calculationId = options.calculationId!;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const costBasisRepo = new CostBasisRepository(database);

      const calcResult = await costBasisRepo.findCalculationById(calculationId);
      if (calcResult.isErr()) {
        console.error(`\n\u26A0 Error: ${calcResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const calculation = calcResult.value;
      if (!calculation) {
        console.error(`\n\u26A0 Calculation not found: ${calculationId}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (calculation.status !== 'completed') {
        console.error(`\n\u26A0 Calculation is not completed (status: ${calculation.status})`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const currency = calculation.config.currency;
      const jurisdiction = calculation.config.jurisdiction;

      const lotsResult = await costBasisRepo.findLotsByCalculationId(calculationId);
      const disposalsResult = await costBasisRepo.findDisposalsByCalculationId(calculationId);

      if (lotsResult.isErr() || disposalsResult.isErr()) {
        const error = lotsResult.isErr()
          ? lotsResult.error
          : disposalsResult.isErr()
            ? disposalsResult.error
            : new Error('Unknown');
        console.error(`\n\u26A0 Error: ${error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const lots = lotsResult.value;
      const disposals = disposalsResult.value;

      let report: CostBasisReport | undefined;
      if (currency !== 'USD') {
        report = await generateReport(costBasisRepo, calculationId, currency, ctx.dataDir);
      }

      const assetItems = buildAssetCostBasisItems(lots, disposals, jurisdiction, currency, report);
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

      const initialState = createCostBasisAssetState(context, sortedAssets, summaryTotals, {
        totalDisposals: calculation.disposalsProcessed,
        totalLots: calculation.lotsCreated,
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
 * If --asset is specified, find the matching asset and jump to its disposal list.
 */
function resolveAssetFilter(
  state: ReturnType<typeof createCostBasisAssetState>,
  assetFilter?: string
): ReturnType<typeof createCostBasisAssetState> | ReturnType<typeof createCostBasisDisposalState> {
  if (!assetFilter) return state;

  const upperFilter = assetFilter.toUpperCase();
  const assetIndex = state.assets.findIndex((a) => a.asset.toUpperCase() === upperFilter);
  if (assetIndex < 0) {
    logger.warn({ asset: assetFilter }, 'Asset filter did not match any assets in the calculation');
    return state;
  }

  const assetItem = state.assets[assetIndex]!;
  return createCostBasisDisposalState(assetItem, state, assetIndex);
}

/**
 * Generate a cost basis report with FX conversion for non-USD currencies.
 */
async function generateReport(
  costBasisRepo: CostBasisRepository,
  calculationId: string,
  displayCurrency: string,
  dataDir: string
): Promise<CostBasisReport | undefined> {
  const priceManagerResult = await createPriceProviderManager({
    providers: { databasePath: path.join(dataDir, 'prices.db') },
  });
  if (priceManagerResult.isErr()) {
    logger.warn({ error: priceManagerResult.error }, 'Failed to create price provider manager for FX conversion');
    return undefined;
  }

  const priceManager = priceManagerResult.value;
  try {
    const fxProvider = new StandardFxRateProvider(priceManager);
    const reportGenerator = new CostBasisReportGenerator(costBasisRepo, fxProvider);

    const reportResult = await reportGenerator.generateReport({
      calculationId,
      displayCurrency,
    });

    if (reportResult.isErr()) {
      logger.warn({ error: reportResult.error }, 'Failed to generate FX report');
      return undefined;
    }

    return reportResult.value;
  } finally {
    await priceManager.destroy();
  }
}
