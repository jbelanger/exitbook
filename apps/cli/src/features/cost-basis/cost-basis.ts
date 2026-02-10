import path from 'node:path';

import type { CostBasisReport } from '@exitbook/accounting';
import {
  CostBasisReportGenerator,
  CostBasisRepository,
  LotTransferRepository,
  StandardFxRateProvider,
  TransactionLinkRepository,
} from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { createPriceProviderManager } from '@exitbook/price-providers';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { unwrapResult } from '../shared/command-execution.js';
import { getDataDir } from '../shared/data-dir.js';
import { withDatabase } from '../shared/database-utils.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { CostBasisCommandOptionsSchema } from '../shared/schemas.js';
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
  results: {
    assetsProcessed: string[];
    disposalsProcessed: number;
    lotsCreated: number;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
    transactionsProcessed: number;
  };
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

    await withDatabase(async (database) => {
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
    await withDatabase(async (database) => {
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

      // Generate report for FX conversion if non-USD
      let report: CostBasisReport | undefined;
      if (currency !== 'USD') {
        const reportResult = await generateReport(costBasisRepo, calculationId, currency);
        if (reportResult) {
          report = reportResult;
        }
      }

      const totals = report?.summary ?? {
        totalProceeds: calculation.totalProceeds,
        totalCostBasis: calculation.totalCostBasis,
        totalGainLoss: calculation.totalGainLoss,
        totalTaxableGainLoss: calculation.totalTaxableGainLoss,
      };

      const resultData: CostBasisCommandResult = {
        calculationId: calculation.id,
        method: calculation.config.method,
        jurisdiction: calculation.config.jurisdiction,
        taxYear: calculation.config.taxYear,
        currency,
        dateRange: {
          startDate: calculation.startDate?.toISOString().split('T')[0] ?? '',
          endDate: calculation.endDate?.toISOString().split('T')[0] ?? '',
        },
        results: {
          lotsCreated: calculation.lotsCreated,
          disposalsProcessed: calculation.disposalsProcessed,
          assetsProcessed: calculation.assetsProcessed,
          transactionsProcessed: calculation.transactionsProcessed,
          totalProceeds: totals.totalProceeds.toFixed(),
          totalCostBasis: totals.totalCostBasis.toFixed(),
          totalGainLoss: totals.totalGainLoss.toFixed(),
          totalTaxableGainLoss: totals.totalTaxableGainLoss.toFixed(),
        },
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
  const { summary, missingPricesWarning, report } = costBasisResult;
  const currency = summary.calculation.config.currency;
  const totals = report?.summary ?? {
    totalProceeds: summary.calculation.totalProceeds,
    totalCostBasis: summary.calculation.totalCostBasis,
    totalGainLoss: summary.calculation.totalGainLoss,
    totalTaxableGainLoss: summary.calculation.totalTaxableGainLoss,
  };

  const resultData: CostBasisCommandResult = {
    calculationId: summary.calculation.id,
    method: summary.calculation.config.method,
    jurisdiction: summary.calculation.config.jurisdiction,
    taxYear: summary.calculation.config.taxYear,
    currency,
    dateRange: {
      startDate: summary.calculation.startDate?.toISOString().split('T')[0] ?? '',
      endDate: summary.calculation.endDate?.toISOString().split('T')[0] ?? '',
    },
    results: {
      lotsCreated: summary.lotsCreated,
      disposalsProcessed: summary.disposalsProcessed,
      assetsProcessed: summary.assetsProcessed,
      transactionsProcessed: summary.calculation.transactionsProcessed,
      totalProceeds: totals.totalProceeds.toFixed(),
      totalCostBasis: totals.totalCostBasis.toFixed(),
      totalGainLoss: totals.totalGainLoss.toFixed(),
      totalTaxableGainLoss: totals.totalTaxableGainLoss.toFixed(),
    },
    missingPricesWarning,
  };

  outputSuccess('cost-basis', resultData);
}

// ─── TUI: Calculate Mode ─────────────────────────────────────────────────────

async function executeCostBasisCalculateTUI(options: CommandOptions): Promise<void> {
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;
  const spinner = createSpinner();

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

    // Show spinner during calculation
    spinner?.start('Calculating cost basis...');

    const dataDir = getDataDir();
    const database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
    const transactionRepo = new TransactionRepository(database);
    const linkRepo = new TransactionLinkRepository(database);
    const costBasisRepo = new CostBasisRepository(database);
    const lotTransferRepo = new LotTransferRepository(database);
    const handler = new CostBasisHandler(transactionRepo, linkRepo, costBasisRepo, lotTransferRepo);

    try {
      const result = await handler.execute(params);
      spinner?.stop();

      if (result.isErr()) {
        console.error(`\n\u26A0 Error: ${result.error.message}`);
        await closeDatabase(database);
        process.exit(ExitCodes.GENERAL_ERROR);
      }

      const costBasisResult = result.value;
      const { summary, missingPricesWarning, report } = costBasisResult;
      const calculation = summary.calculation;
      const currency = calculation.config.currency;
      const jurisdiction = calculation.config.jurisdiction;

      // Load lots and disposals for the TUI
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
        await closeDatabase(database);
        process.exit(ExitCodes.GENERAL_ERROR);
      }

      const lots = lotsResult.value;
      const disposals = disposalsResult.value;

      // Build asset items
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

      // If --asset filter, jump directly to disposal list
      const finalState = resolveAssetFilter(initialState, options.asset);

      await closeDatabase(database);

      // Render TUI
      await new Promise<void>((resolve, reject) => {
        inkInstance = render(
          React.createElement(CostBasisApp, {
            initialState: finalState,
            onQuit: () => {
              if (inkInstance) inkInstance.unmount();
            },
          })
        );
        inkInstance.waitUntilExit().then(resolve).catch(reject);
      });
    } catch (error) {
      spinner?.stop();
      await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    spinner?.stop();
    console.error('\n\u26A0 Error:', error instanceof Error ? error.message : String(error));
    process.exit(ExitCodes.GENERAL_ERROR);
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore */
      }
    }
  }
}

// ─── TUI: View Mode (--calculation-id) ──────────────────────────────────────

async function executeCostBasisViewTUI(options: CommandOptions): Promise<void> {
  const calculationId = options.calculationId!;
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  const spinner = createSpinner();
  spinner?.start('Loading cost basis results...');

  const dataDir = getDataDir();
  const database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
  const costBasisRepo = new CostBasisRepository(database);

  try {
    // Load calculation
    const calcResult = await costBasisRepo.findCalculationById(calculationId);
    if (calcResult.isErr()) {
      spinner?.stop();
      console.error(`\n\u26A0 Error: ${calcResult.error.message}`);
      process.exit(ExitCodes.GENERAL_ERROR);
    }

    const calculation = calcResult.value;
    if (!calculation) {
      spinner?.stop();
      console.error(`\n\u26A0 Calculation not found: ${calculationId}`);
      process.exit(ExitCodes.GENERAL_ERROR);
    }

    if (calculation.status !== 'completed') {
      spinner?.stop();
      console.error(`\n\u26A0 Calculation is not completed (status: ${calculation.status})`);
      process.exit(ExitCodes.GENERAL_ERROR);
    }

    const currency = calculation.config.currency;
    const jurisdiction = calculation.config.jurisdiction;

    // Load lots and disposals
    const lotsResult = await costBasisRepo.findLotsByCalculationId(calculationId);
    const disposalsResult = await costBasisRepo.findDisposalsByCalculationId(calculationId);

    if (lotsResult.isErr() || disposalsResult.isErr()) {
      spinner?.stop();
      const error = lotsResult.isErr()
        ? lotsResult.error
        : disposalsResult.isErr()
          ? disposalsResult.error
          : new Error('Unknown');
      console.error(`\n\u26A0 Error: ${error.message}`);
      process.exit(ExitCodes.GENERAL_ERROR);
    }

    const lots = lotsResult.value;
    const disposals = disposalsResult.value;

    // Generate report for FX conversion if non-USD
    let report: CostBasisReport | undefined;
    if (currency !== 'USD') {
      report = await generateReport(costBasisRepo, calculationId, currency);
    }

    spinner?.stop();

    // Build asset items
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

    // If --asset filter, jump directly to disposal list
    const finalState = resolveAssetFilter(initialState, options.asset);

    // Render TUI
    await new Promise<void>((resolve, reject) => {
      inkInstance = render(
        React.createElement(CostBasisApp, {
          initialState: finalState,
          onQuit: () => {
            if (inkInstance) inkInstance.unmount();
          },
        })
      );
      inkInstance.waitUntilExit().then(resolve).catch(reject);
    });
  } catch (error) {
    spinner?.stop();
    console.error('\n\u26A0 Error:', error instanceof Error ? error.message : String(error));
    process.exit(ExitCodes.GENERAL_ERROR);
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore */
      }
    }
    await closeDatabase(database);
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
  displayCurrency: string
): Promise<CostBasisReport | undefined> {
  const dataDir = getDataDir();
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

function createSpinner(): { start: (msg: string) => void; stop: () => void } | undefined {
  try {
    let interval: ReturnType<typeof setInterval> | undefined;
    const frames = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
    let frameIndex = 0;

    return {
      start(msg: string) {
        interval = setInterval(() => {
          process.stderr.write(`\r${frames[frameIndex % frames.length]} ${msg}`);
          frameIndex++;
        }, 80);
      },
      stop() {
        if (interval) {
          clearInterval(interval);
          process.stderr.write('\r\x1b[K');
        }
      },
    };
  } catch {
    return undefined;
  }
}
