import type { CostBasisReport } from '@exitbook/accounting';
import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { Decimal } from 'decimal.js';
import type { z } from 'zod';

import { resolveCommandParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { CostBasisCommandOptionsSchema } from '../shared/schemas.js';

import type { CostBasisResult } from './cost-basis-handler.js';
import { CostBasisHandler } from './cost-basis-handler.js';
import { promptForCostBasisParams } from './cost-basis-prompts.js';
import { buildCostBasisParamsFromFlags } from './cost-basis-utils.js';

const logger = getLogger('CostBasisCommand');

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
    .action(async (rawOptions: unknown) => {
      await executeCostBasisCommand(rawOptions);
    });
}

/**
 * Execute the cost-basis command.
 */
async function executeCostBasisCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = CostBasisCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    output.error(
      'cost-basis',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildCostBasisParamsFromFlags(options)),
      cancelMessage: 'Cost basis calculation cancelled',
      commandName: 'cost-basis',
      confirmMessage: 'Start cost basis calculation?',
      isInteractive: !options.method && !options.jurisdiction && !options.taxYear && !options.json,
      output,
      promptFn: promptForCostBasisParams,
    });

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

      handler.destroy();
      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('cost-basis', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleCostBasisSuccess(output, result.value);
    } catch (error) {
      handler.destroy();
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
  }

  // Prepare result data for JSON mode
  // Use converted amounts if report exists, otherwise use original USD amounts
  const currency = summary.calculation.config.currency;
  const totals = report
    ? report.summary
    : {
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
      startDate: summary.calculation.startDate ? (summary.calculation.startDate.toISOString().split('T')[0] ?? '') : '',
      endDate: summary.calculation.endDate ? (summary.calculation.endDate.toISOString().split('T')[0] ?? '') : '',
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
  process.exit(0);
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

  logger.info('\nCost Basis Calculation Results');
  logger.info('================================');
  logger.info(`Calculation ID: ${calculation.id}`);
  logger.info(`Method: ${calculation.config.method.toUpperCase()}`);
  logger.info(`Jurisdiction: ${calculation.config.jurisdiction}`);
  logger.info(`Tax Year: ${calculation.config.taxYear}`);
  logger.info(`Currency: ${calculation.config.currency}`);
  logger.info(
    `Date Range: ${calculation.startDate?.toISOString().split('T')[0] || 'N/A'} to ${calculation.endDate?.toISOString().split('T')[0] || 'N/A'}`
  );
  console.log(''); // Add spacing

  logger.info('Processing Summary');
  logger.info('------------------');
  logger.info(`✓ Transactions processed: ${calculation.transactionsProcessed}`);
  logger.info(`✓ Assets processed: ${assetsProcessed.length} (${assetsProcessed.join(', ')})`);
  logger.info(`✓ Acquisition lots created: ${lotsCreated}`);
  logger.info(`✓ Disposals processed: ${disposalsProcessed}`);
  console.log(''); // Add spacing

  // Use converted amounts if report exists, otherwise use original USD amounts
  const displayCurrency = calculation.config.currency;
  const totals = report
    ? report.summary
    : {
        totalProceeds: calculation.totalProceeds,
        totalCostBasis: calculation.totalCostBasis,
        totalGainLoss: calculation.totalGainLoss,
        totalTaxableGainLoss: calculation.totalTaxableGainLoss,
      };

  logger.info('Financial Summary');
  logger.info('------------------');
  logger.info(`Total Proceeds: ${formatCurrency(totals.totalProceeds, displayCurrency)}`);
  logger.info(`Total Cost Basis: ${formatCurrency(totals.totalCostBasis, displayCurrency)}`);
  logger.info(`Capital Gain/Loss: ${formatCurrency(totals.totalGainLoss, displayCurrency)}`);
  logger.info(`Taxable Gain/Loss: ${formatCurrency(totals.totalTaxableGainLoss, displayCurrency)}`);

  // Show FX conversion note if applicable
  if (report && report.displayCurrency !== 'USD') {
    console.log(''); // Add spacing
    logger.info(
      `Note: Amounts converted from USD to ${report.displayCurrency} using historical rates at disposal time`
    );
    logger.info(
      `      Original USD totals: Proceeds=${formatCurrency(report.originalSummary.totalProceeds, 'USD')}, ` +
        `Gain/Loss=${formatCurrency(report.originalSummary.totalGainLoss, 'USD')}`
    );
  }

  // Show jurisdiction-specific note
  if (calculation.config.jurisdiction === 'CA') {
    console.log(''); // Add spacing
    logger.info('Tax Rules: Canadian tax rules applied (50% capital gains inclusion rate)');
  } else if (calculation.config.jurisdiction === 'US') {
    console.log(''); // Add spacing
    logger.info('Tax Rules: US tax rules applied (short-term vs long-term classification)');
    logger.info('           Review lot disposals for holding period classifications');
  }

  // Show warning if any transactions were excluded
  if (missingPricesWarning) {
    console.log(''); // Add spacing
    logger.warn(`⚠ ${missingPricesWarning}`);
  }

  console.log(''); // Add spacing
  logger.info(`Results saved to database with calculation ID: ${calculation.id}`);
  logger.info('Use this ID to query detailed lot and disposal records.');
}

/**
 * Format currency value for display
 */
function formatCurrency(amount: Decimal, currency: string): string {
  const isNegative = amount.isNegative();
  const absFormatted = amount.abs().toFixed(2);

  // Add thousands separators
  const parts = absFormatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const withSeparators = parts.join('.');

  return `${isNegative ? '-' : ''}${currency} ${withSeparators}`;
}
