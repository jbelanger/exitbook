// Command registration for prices derive subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { PricesDeriveHandler, type PricesDeriveResult } from './prices-derive-handler.ts';

/**
 * Register the prices derive subcommand.
 */
export function registerPricesDeriveCommand(pricesCommand: Command): void {
  pricesCommand
    .command('derive')
    .description('Derive prices from your transaction history (fiat/stable trades)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: { json?: boolean }) => {
      await executePricesDeriveCommand(options);
    });
}

/**
 * Execute the prices derive command.
 */
async function executePricesDeriveCommand(options: { json?: boolean }): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();
    spinner?.start('Deriving prices from transaction history...');

    // Configure logger to route logs to spinner
    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    const result = await withDatabaseAndHandler(PricesDeriveHandler, {});

    // Reset logger context after command completes
    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Price derivation failed');
      output.error('prices-derive', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handlePricesDeriveSuccess(output, result.value, spinner);
  } catch (error) {
    output.error('prices-derive', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful prices derive.
 */
function handlePricesDeriveSuccess(
  output: OutputManager,
  result: PricesDeriveResult,
  spinner: ReturnType<OutputManager['spinner']>
) {
  const completionMessage = `Price derivation complete - ${result.movementsEnriched} movements enriched`;
  spinner?.stop(completionMessage);

  // Display text output
  if (output.isTextMode()) {
    console.log('');
    console.log('Price Derivation Complete:');
    console.log('==========================');
    console.log(`Total movements: ${result.totalMovements}`);
    console.log(`✓ Enriched:      ${result.movementsEnriched} movements`);
    console.log(`  Still needed:  ${result.movementsStillNeedingPrices} movements`);

    if (result.movementsStillNeedingPrices > 0) {
      const percentComplete = (
        ((result.totalMovements - result.movementsStillNeedingPrices) / result.totalMovements) *
        100
      ).toFixed(1);
      console.log('');
      console.log(`Progress: ${percentComplete}% of movements have prices`);
      console.log('');
      console.log("Next step: Run 'prices fetch' to fill remaining gaps");
      console.log('  pnpm dev -- prices fetch');
    } else {
      console.log('');
      console.log('✓ All movements have prices!');
    }
  }

  // Output success (JSON mode)
  output.success('prices-derive', result);
  process.exit(0);
}
