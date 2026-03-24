/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price rederive - Use newly fetched/normalized prices for ratio calculations
 */
import type { PricesEnrichOptions } from '@exitbook/accounting';
import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { isJsonMode } from '../../shared/json-mode.js';
import { outputSuccess } from '../../shared/json-output.js';

import { PricesEnrichCommandOptionsSchema } from './prices-option-schemas.js';
import { runPricesEnrich } from './run-prices-enrich.js';

/**
 * Register the prices enrich subcommand
 */
export function registerPricesEnrichCommand(pricesCommand: Command, appRuntime: CliAppRuntime): void {
  pricesCommand
    .command('enrich')
    .description('Enrich prices via derive → fetch → normalize pipeline')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--on-missing <behavior>', 'How to handle missing prices: fail (abort on first error)')
    .option('--normalize-only', 'Only run FX rates stage')
    .option('--derive-only', 'Only run trade prices stage')
    .option('--fetch-only', 'Only run market prices stage')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executePricesEnrichCommand(rawOptions, appRuntime));
}

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executePricesEnrichCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
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
  const params: PricesEnrichOptions = {
    asset: options.asset,
    onMissing: options.onMissing,
    normalizeOnly: options.normalizeOnly,
    deriveOnly: options.deriveOnly,
    fetchOnly: options.fetchOnly,
  };

  if (options.json) {
    await executePricesEnrichJSON(params, appRuntime);
  } else {
    await executePricesEnrichTUI(params, appRuntime);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executePricesEnrichJSON(params: PricesEnrichOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await runPricesEnrich(ctx, { isJsonMode: true }, params);
      if (result.isErr()) {
        displayCliError('prices-enrich', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputSuccess('prices-enrich', result.value);
    });
  } catch (error) {
    displayCliError(
      'prices-enrich',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI Mode ────────────────────────────────────────────────────────────────

async function executePricesEnrichTUI(params: PricesEnrichOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await runPricesEnrich(ctx, { isJsonMode: false }, params);
      if (result.isErr()) {
        displayCliError('prices-enrich', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }
    });
  } catch (error) {
    displayCliError(
      'prices-enrich',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
