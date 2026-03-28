// Prices set-fx command - manually set FX rate
// Allows bulk preparation of manual FX rates without interrupting enrichment

import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';

import { runCommand, withCommandPriceProviderRuntime } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { PricesSetFxCommandOptionsSchema } from './prices-option-schemas.js';
import { PricesSetFxHandler } from './prices-set-fx-handler.js';

/**
 * Register prices set-fx command
 */
export function registerPricesSetFxCommand(pricesCommand: Command): void {
  pricesCommand
    .command('set-fx')
    .description('Manually set FX rate between two currencies')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices set-fx --from EUR --to USD --date 2024-01-15T00:00:00Z --rate 1.08
  $ exitbook prices set-fx --from CAD --to USD --date 2024-01-15T00:00:00Z --rate 0.74
  $ exitbook prices set-fx --from EUR --to USD --date 2024-01-15T00:00:00Z --rate 1.08 --source analyst-review
  $ exitbook prices set-fx --from EUR --to USD --date 2024-01-15T00:00:00Z --rate 1.08 --json

Notes:
  - Timestamps must use ISO 8601 format.
  - Manual FX rates are stored as profile-scoped override data.
`
    )
    .requiredOption('--from <currency>', 'Source currency (e.g., EUR, CAD)')
    .requiredOption('--to <currency>', 'Target currency (e.g., USD)')
    .requiredOption('--date <datetime>', 'Date/time (ISO 8601 format, e.g., 2024-01-15T10:30:00Z)')
    .requiredOption('--rate <value>', 'FX rate value (e.g., 1.08 for EUR→USD)')
    .option('--source <name>', 'Source attribution', 'user-provided')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executePricesSetFxCommand(rawOptions);
    });
}

/**
 * Execute the prices set-fx command.
 */
async function executePricesSetFxCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('prices-set-fx', rawOptions, PricesSetFxCommandOptionsSchema);

  try {
    await runCommand(async (ctx) => {
      const overrideStore = new OverrideStore(ctx.dataDir);
      const result = await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
        const handler = new PricesSetFxHandler(priceRuntime, overrideStore);
        const executeResult = await handler.execute({
          from: options.from,
          to: options.to,
          date: options.date,
          rate: options.rate,
          source: options.source,
          profileKey: ctx.activeProfileKey,
        });
        if (executeResult.isErr()) {
          throw executeResult.error;
        }

        return executeResult.value;
      });

      if (result.isErr()) {
        displayCliError('prices-set-fx', result.error, ExitCodes.GENERAL_ERROR, format);
      }

      if (format === 'json') {
        outputSuccess('prices-set-fx', result.value);
      } else {
        console.log('✅ FX rate set successfully');
        console.log(`   From: ${result.value.from}`);
        console.log(`   To: ${result.value.to}`);
        console.log(`   Date: ${result.value.timestamp.toISOString()}`);
        console.log(`   Rate: ${result.value.rate}`);
        console.log(`   Source: ${result.value.source}`);
      }
    });
  } catch (error) {
    displayCliError(
      'prices-set-fx',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      format
    );
  }
}
