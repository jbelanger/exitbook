import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';
import type { Decimal } from 'decimal.js';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { CostBasisResult } from './cost-basis-handler.ts';
import { CostBasisHandler } from './cost-basis-handler.ts';
import { promptForCostBasisParams } from './cost-basis-prompts.ts';
import type { CostBasisCommandOptions } from './cost-basis-utils.ts';
import { buildCostBasisParamsFromFlags } from './cost-basis-utils.ts';

const logger = getLogger('CostBasisCommand');

/**
 * Extended cost-basis command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedCostBasisCommandOptions extends CostBasisCommandOptions {
  json?: boolean | undefined;
}

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedCostBasisCommandOptions) => {
      await executeCostBasisCommand(options);
    });
}

/**
 * Execute the cost-basis command.
 */
async function executeCostBasisCommand(options: ExtendedCostBasisCommandOptions): Promise<void> {
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

    const result = await withDatabaseAndHandler(CostBasisHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('cost-basis', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleCostBasisSuccess(output, result.value);
  } catch (error) {
    output.error('cost-basis', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful cost basis calculation.
 */
function handleCostBasisSuccess(output: OutputManager, costBasisResult: CostBasisResult): void {
  const { summary, missingPricesWarning } = costBasisResult;

  // Display results in text mode
  if (output.isTextMode()) {
    output.outro('✨ Cost basis calculation complete!');
    console.log(''); // Add spacing before results
    displayCostBasisResults(summary, missingPricesWarning);
  }

  // Prepare result data for JSON mode
  const resultData: CostBasisCommandResult = {
    calculationId: summary.calculation.id,
    method: summary.calculation.config.method,
    jurisdiction: summary.calculation.config.jurisdiction,
    taxYear: summary.calculation.config.taxYear,
    currency: summary.calculation.config.currency,
    dateRange: {
      startDate: summary.calculation.startDate ? (summary.calculation.startDate.toISOString().split('T')[0] ?? '') : '',
      endDate: summary.calculation.endDate ? (summary.calculation.endDate.toISOString().split('T')[0] ?? '') : '',
    },
    results: {
      lotsCreated: summary.lotsCreated,
      disposalsProcessed: summary.disposalsProcessed,
      assetsProcessed: summary.assetsProcessed,
      transactionsProcessed: summary.calculation.transactionsProcessed,
      totalProceeds: summary.calculation.totalProceeds.toString(),
      totalCostBasis: summary.calculation.totalCostBasis.toString(),
      totalGainLoss: summary.calculation.totalGainLoss.toString(),
      totalTaxableGainLoss: summary.calculation.totalTaxableGainLoss.toString(),
    },
    missingPricesWarning,
  };

  output.success('cost-basis', resultData);
  process.exit(0);
}

/**
 * Display cost basis results in the console.
 */
function displayCostBasisResults(summary: CostBasisResult['summary'], missingPricesWarning?: string): void {
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

  logger.info('Financial Summary');
  logger.info('------------------');
  logger.info(`Total Proceeds: ${formatCurrency(calculation.totalProceeds, calculation.config.currency)}`);
  logger.info(`Total Cost Basis: ${formatCurrency(calculation.totalCostBasis, calculation.config.currency)}`);
  logger.info(`Capital Gain/Loss: ${formatCurrency(calculation.totalGainLoss, calculation.config.currency)}`);
  logger.info(`Taxable Gain/Loss: ${formatCurrency(calculation.totalTaxableGainLoss, calculation.config.currency)}`);

  // Show jurisdiction-specific note
  if (calculation.config.jurisdiction === 'CA') {
    console.log(''); // Add spacing
    logger.info('Note: Canadian tax rules applied (50% capital gains inclusion rate)');
  } else if (calculation.config.jurisdiction === 'US') {
    console.log(''); // Add spacing
    logger.info('Note: US tax rules applied (short-term vs long-term classification)');
    logger.info('      Review lot disposals for holding period classifications');
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
