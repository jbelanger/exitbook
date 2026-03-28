// Prices set command - manually set price for an asset
// Allows bulk preparation of manual prices without interrupting enrichment

import type { Command } from 'commander';

import { runCommand, withCommandPriceProviderRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';

import { PricesSetCommandOptionsSchema } from './prices-option-schemas.js';
import { PricesSetHandler } from './prices-set-handler.js';

/**
 * Register prices set command
 */
export function registerPricesSetCommand(pricesCommand: Command): void {
  pricesCommand
    .command('set')
    .description('Manually set price for an asset at a specific time')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices set --asset BTC --date 2024-01-15T10:30:00Z --price 45000.50
  $ exitbook prices set --asset ETH --date 2024-01-15T10:30:00Z --price 3200 --currency CAD
  $ exitbook prices set --asset BTC --date 2024-01-15T10:30:00Z --price 45000.50 --source analyst-review
  $ exitbook prices set --asset BTC --date 2024-01-15T10:30:00Z --price 45000.50 --json

Notes:
  - Timestamps must use ISO 8601 format.
  - Manual prices are stored as profile-scoped override data.
`
    )
    .requiredOption('--asset <symbol>', 'Asset symbol (e.g., BTC, ETH)')
    .requiredOption('--date <datetime>', 'Date/time (ISO 8601 format, e.g., 2024-01-15T10:30:00Z)')
    .requiredOption('--price <amount>', 'Price value (e.g., 45000.50)')
    .option('--currency <code>', 'Price currency', 'USD')
    .option('--source <name>', 'Source attribution', 'manual-cli')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executePricesSetCommand(rawOptions);
    });
}

/**
 * Execute the prices set command.
 */
async function executePricesSetCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('prices-set', rawOptions, PricesSetCommandOptionsSchema);

  try {
    const { OverrideStore } = await import('@exitbook/data/overrides');
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('prices-set', profileResult.error, ExitCodes.GENERAL_ERROR, format);
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const result = await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
        const handler = new PricesSetHandler(priceRuntime, overrideStore);
        const executeResult = await handler.execute({
          asset: options.asset,
          date: options.date,
          price: options.price,
          currency: options.currency,
          source: options.source,
          profileKey: profileResult.value.profileKey,
        });
        if (executeResult.isErr()) {
          throw executeResult.error;
        }

        return executeResult.value;
      });

      if (result.isErr()) {
        displayCliError('prices-set', result.error, ExitCodes.GENERAL_ERROR, format);
      }

      if (format === 'json') {
        outputSuccess('prices-set', result.value);
      } else {
        console.log('✅ Price set successfully');
        console.log(`   Asset: ${result.value.asset}`);
        console.log(`   Date: ${result.value.timestamp.toISOString()}`);
        console.log(`   Price: ${result.value.price} ${result.value.currency}`);
        console.log(`   Source: ${result.value.source}`);
      }
    });
  } catch (error) {
    displayCliError(
      'prices-set',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      format
    );
  }
}
