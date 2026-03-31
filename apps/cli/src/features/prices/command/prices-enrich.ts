/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price rederive - Use newly fetched/normalized prices for ratio calculations
 */
import type { PricesEnrichOptions, PricesEnrichResult } from '@exitbook/accounting/price-enrichment';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCliRuntimeAction, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { jsonSuccess, silentSuccess, toCliResult, type CliCommandResult } from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import { withPricesEnrichCommandScope } from './prices-enrich-command-scope.js';
import { PricesEnrichCommandOptionsSchema } from './prices-option-schemas.js';
import { runPricesEnrich } from './run-prices-enrich.js';

type PricesEnrichCommandOptions = z.infer<typeof PricesEnrichCommandOptionsSchema>;

export function registerPricesEnrichCommand(pricesCommand: Command, appRuntime: CliAppRuntime): void {
  pricesCommand
    .command('enrich')
    .description('Enrich prices via derive → fetch → normalize pipeline')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices enrich
  $ exitbook prices enrich --asset BTC --asset ETH
  $ exitbook prices enrich --derive-only
  $ exitbook prices enrich --fetch-only --on-missing fail --json

Notes:
  - Repeat --asset to scope enrichment to a small set of symbols.
  - Use the stage flags to isolate part of the pipeline during debugging.
`
    )
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--on-missing <behavior>', 'How to handle missing prices: fail (abort on first error)')
    .option('--normalize-only', 'Only run FX rates stage')
    .option('--derive-only', 'Only run trade prices stage')
    .option('--fetch-only', 'Only run market prices stage')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executePricesEnrichCommand(rawOptions, appRuntime));
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executePricesEnrichCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'prices-enrich',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, PricesEnrichCommandOptionsSchema);
        return yield* await executePricesEnrichCommandResult(buildPricesEnrichParams(options), format, appRuntime);
      }),
  });
}

async function executePricesEnrichCommandResult(
  params: PricesEnrichOptions,
  format: CliOutputFormat,
  appRuntime: CliAppRuntime
): Promise<CliCommandResult> {
  return runCliRuntimeAction({
    command: 'prices-enrich',
    appRuntime,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withPricesEnrichCommandScope(ctx, (scope) => runPricesEnrich(scope, { format }, params)),
          ExitCodes.GENERAL_ERROR
        );

        return buildPricesEnrichCompletion(result, format);
      }),
  });
}

function buildPricesEnrichParams(options: PricesEnrichCommandOptions): PricesEnrichOptions {
  return {
    asset: options.asset,
    onMissing: options.onMissing,
    normalizeOnly: options.normalizeOnly,
    deriveOnly: options.deriveOnly,
    fetchOnly: options.fetchOnly,
  };
}

function buildPricesEnrichCompletion(result: PricesEnrichResult, format: CliOutputFormat) {
  if (format === 'json') {
    return jsonSuccess(result);
  }

  return silentSuccess();
}
