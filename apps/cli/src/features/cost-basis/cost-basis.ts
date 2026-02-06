import type { CostBasisReport } from '@exitbook/accounting';
import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, promptConfirm } from '../shared/prompts.js';
import { CostBasisCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';
import { formatDate } from '../shared/view-utils.js';

import type { CostBasisResult } from './cost-basis-handler.js';
import { CostBasisHandler } from './cost-basis-handler.js';
import { promptForCostBasisParams } from './cost-basis-prompts.js';
import { buildCostBasisParamsFromFlags, formatCurrency, type CostBasisHandlerParams } from './cost-basis-utils.js';

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
    .option('--json', 'Output results in JSON format')
    .action(executeCostBasisCommand);
}

async function executeCostBasisCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJson = isJsonMode(rawOptions);

  // Validate options at CLI boundary
  const parseResult = CostBasisCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJson ? 'json' : 'text');
    output.error(
      'cost-basis',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    let params: CostBasisHandlerParams;
    if (!options.method && !options.jurisdiction && !options.taxYear && !options.json) {
      output.intro('exitbook cost-basis');
      params = await promptForCostBasisParams();
      const shouldProceed = await promptConfirm('Start cost basis calculation?', true);
      if (!shouldProceed) {
        handleCancellation('Cost basis calculation cancelled');
      }
    } else {
      params = unwrapResult(buildCostBasisParamsFromFlags(options));
    }

    const spinner = output.spinner();
    spinner?.start('Calculating cost basis...');

    // Configure logger if no spinner (JSON mode)
    if (!spinner) {
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false,
        sinks: options.json ? { ui: false, structured: 'file' } : { ui: false, structured: 'stdout' },
      });
    }

    const database = await initializeDatabase();
    const transactionRepo = new TransactionRepository(database);
    const linkRepo = new TransactionLinkRepository(database);
    const costBasisRepo = new CostBasisRepository(database);
    const lotTransferRepo = new LotTransferRepository(database);
    const handler = new CostBasisHandler(transactionRepo, linkRepo, costBasisRepo, lotTransferRepo);

    try {
      const result = await handler.execute(params);

      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('cost-basis', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleCostBasisSuccess(output, result.value);
    } catch (error) {
      await closeDatabase(database);
      spinner?.stop('Cost basis calculation failed');
      resetLoggerContext();
      throw error;
    }
  } catch (error) {
    resetLoggerContext();
    output.error('cost-basis', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful cost basis calculation.
 */
function handleCostBasisSuccess(output: OutputManager, costBasisResult: CostBasisResult): void {
  const { summary, missingPricesWarning, report } = costBasisResult;

  // Display results in text mode
  if (output.isTextMode()) {
    output.outro('✨ Cost basis calculation complete!');
    console.log(''); // Add spacing before results
    displayCostBasisResults(summary, report, missingPricesWarning);
    return;
  }

  // JSON output
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

  output.json('cost-basis', resultData);
}

/**
 * Display cost basis results in the console.
 */
function displayCostBasisResults(
  summary: CostBasisResult['summary'],
  report?: CostBasisReport,
  missingPricesWarning?: string
): void {
  const { calculation, lotsCreated, disposalsProcessed, assetsProcessed } = summary;
  const config = calculation.config;

  console.log('\nCost Basis Calculation Results');
  console.log('================================');
  console.log(`Calculation ID: ${calculation.id}`);
  console.log(`Method: ${config.method.toUpperCase()}`);
  console.log(`Jurisdiction: ${config.jurisdiction}`);
  console.log(`Tax Year: ${config.taxYear}`);
  console.log(`Currency: ${config.currency}`);
  const startDate = calculation.startDate ? formatDate(calculation.startDate) : 'N/A';
  const endDate = calculation.endDate ? formatDate(calculation.endDate) : 'N/A';
  console.log(`Date Range: ${startDate} to ${endDate}`);
  console.log('');

  console.log('Processing Summary');
  console.log('------------------');
  console.log(`✓ Transactions processed: ${calculation.transactionsProcessed}`);
  console.log(`✓ Assets processed: ${assetsProcessed.length} (${assetsProcessed.join(', ')})`);
  console.log(`✓ Acquisition lots created: ${lotsCreated}`);
  console.log(`✓ Disposals processed: ${disposalsProcessed}`);
  console.log('');

  // Use converted amounts if report exists, otherwise use original USD amounts
  const displayCurrency = config.currency;
  const totals = report?.summary ?? {
    totalProceeds: calculation.totalProceeds,
    totalCostBasis: calculation.totalCostBasis,
    totalGainLoss: calculation.totalGainLoss,
    totalTaxableGainLoss: calculation.totalTaxableGainLoss,
  };

  console.log('Financial Summary');
  console.log('------------------');
  console.log(`Total Proceeds: ${formatCurrency(totals.totalProceeds, displayCurrency)}`);
  console.log(`Total Cost Basis: ${formatCurrency(totals.totalCostBasis, displayCurrency)}`);
  console.log(`Capital Gain/Loss: ${formatCurrency(totals.totalGainLoss, displayCurrency)}`);
  console.log(`Taxable Gain/Loss: ${formatCurrency(totals.totalTaxableGainLoss, displayCurrency)}`);

  // Show FX conversion note if applicable
  if (report && report.displayCurrency !== 'USD') {
    console.log('');
    console.log(
      `Note: Amounts converted from USD to ${report.displayCurrency} using historical rates at disposal time`
    );
    console.log(
      `      Original USD totals: Proceeds=${formatCurrency(report.originalSummary.totalProceeds, 'USD')}, ` +
        `Gain/Loss=${formatCurrency(report.originalSummary.totalGainLoss, 'USD')}`
    );
  }

  // Show jurisdiction-specific note
  if (config.jurisdiction === 'CA') {
    console.log('\nTax Rules: Canadian tax rules applied (50% capital gains inclusion rate)');
  } else if (config.jurisdiction === 'US') {
    console.log('\nTax Rules: US tax rules applied (short-term vs long-term classification)');
    console.log('           Review lot disposals for holding period classifications');
  }

  // Show warning if any transactions were excluded
  if (missingPricesWarning) {
    console.log(`\n⚠ ${missingPricesWarning}`);
  }

  console.log(`\nResults saved to database with calculation ID: ${calculation.id}`);
  console.log('Use this ID to query detailed lot and disposal records.');
}
