/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price propagation - Use newly fetched/normalized prices for ratio calculations
 */
import type { PricesEnrichOptions } from '@exitbook/accounting';
import type { Command } from 'commander';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { PricesEnrichCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { createPricesEnrichHandler } from './prices-enrich-handler.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesEnrichCommandOptionsSchema>;

/**
 * Register the prices enrich subcommand
 */
export function registerPricesEnrichCommand(pricesCommand: Command): void {
  pricesCommand
    .command('enrich')
    .description('Enrich prices via derive → fetch → normalize pipeline')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--on-missing <behavior>', 'How to handle missing prices: fail (abort on first error)')
    .option('--normalize-only', 'Only run FX rates stage')
    .option('--derive-only', 'Only run trade prices stage')
    .option('--fetch-only', 'Only run market prices stage')
    .option('--json', 'Output results in JSON format')
    .action(executePricesEnrichCommand);
}

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executePricesEnrichCommand(rawOptions: unknown): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const parseResult = PricesEnrichCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'prices-enrich',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    const params: PricesEnrichOptions = {
      asset: options.asset,
      onMissing: options.onMissing,
      normalizeOnly: options.normalizeOnly,
      deriveOnly: options.deriveOnly,
      fetchOnly: options.fetchOnly,
    };

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createPricesEnrichHandler(ctx, database, { isJsonMode: !!options.json });

      if (handlerResult.isErr()) {
        if (options.json) {
          displayCliError('prices-enrich', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
        }
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const handler = handlerResult.value;

      if (!options.json) {
        ctx.onAbort(() => handler.abort());
      }

      const result = await handler.execute(params);

      if (result.isErr()) {
        if (options.json) {
          displayCliError('prices-enrich', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (options.json) {
        outputSuccess('prices-enrich', result.value);
      }
    });
  } catch (error) {
    displayCliError(
      'prices-enrich',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}
