import { OverrideStore } from '@exitbook/data/overrides';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult, type CliOutputFormat } from '../../../cli/options.js';
import { withCommandPriceProviderRuntime, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { PricesSetFxCommandOptionsSchema } from './prices-option-schemas.js';
import { PricesSetFxHandler } from './prices-set-fx-handler.js';

type PricesSetFxCommandOptions = z.infer<typeof PricesSetFxCommandOptionsSchema>;

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

async function executePricesSetFxCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'prices-set-fx',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, PricesSetFxCommandOptionsSchema);
      }),
    action: async (context) => executePricesSetFxCommandResult(context.runtime, context.prepared, format),
  });
}

async function executePricesSetFxCommandResult(
  ctx: CommandRuntime,
  options: PricesSetFxCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const overrideStore = new OverrideStore(ctx.dataDir);

    const result = yield* toCliResult(
      await withCommandPriceProviderRuntime(ctx, undefined, async (priceRuntime) => {
        const handler = new PricesSetFxHandler(priceRuntime, overrideStore);
        return handler.execute({
          from: options.from,
          to: options.to,
          date: options.date,
          rate: options.rate,
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
      console.log('✓ FX rate set successfully');
      console.log(`   From: ${result.from}`);
      console.log(`   To: ${result.to}`);
      console.log(`   Date: ${result.timestamp.toISOString()}`);
      console.log(`   Rate: ${result.rate}`);
      console.log(`   Source: ${result.source}`);
    });
  });
}
