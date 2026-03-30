import { OverrideStore } from '@exitbook/data/overrides';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import { withCommandPriceProviderRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, textSuccess, toCliResult, type CliCommandResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import { PricesSetCommandOptionsSchema } from './prices-option-schemas.js';
import { PricesSetHandler } from './prices-set-handler.js';

type PricesSetCommandOptions = z.infer<typeof PricesSetCommandOptionsSchema>;

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

async function executePricesSetCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'prices-set',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, PricesSetCommandOptionsSchema);
        return yield* await executePricesSetCommandResult(options, format);
      }),
  });
}

async function executePricesSetCommandResult(
  options: PricesSetCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: 'prices-set',
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const database = await ctx.database();
        const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
        const overrideStore = new OverrideStore(ctx.dataDir);

        const result = yield* toCliResult(
          await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
            const handler = new PricesSetHandler(priceRuntime, overrideStore);
            return handler.execute({
              asset: options.asset,
              date: options.date,
              price: options.price,
              currency: options.currency,
              source: options.source,
              profileKey: profile.profileKey,
            });
          }),
          ExitCodes.GENERAL_ERROR
        );

        if (format === 'json') {
          return jsonSuccess(result);
        }

        return textSuccess(() => {
          console.log('✓ Price set successfully');
          console.log(`   Asset: ${result.asset}`);
          console.log(`   Date: ${result.timestamp.toISOString()}`);
          console.log(`   Price: ${result.price} ${result.currency}`);
          console.log(`   Source: ${result.source}`);
        });
      }),
  });
}
