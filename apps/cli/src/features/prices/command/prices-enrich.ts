/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with four sequential stages:
 * 1. Trade prices - Extract prices from trades (USD + fiat) and propagate via links
 * 2. FX rates - Convert non-USD fiat prices to USD using FX providers
 * 3. Market prices - Fetch missing crypto prices from external providers
 * 4. Price rederive - Use newly fetched/normalized prices for ratio calculations
 */
import type { PricesEnrichOptions } from '@exitbook/accounting/price-enrichment';
import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
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

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executePricesEnrichCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const { format, options } = parseCliCommandOptions('prices-enrich', rawOptions, PricesEnrichCommandOptionsSchema);
  const params: PricesEnrichOptions = {
    asset: options.asset,
    onMissing: options.onMissing,
    normalizeOnly: options.normalizeOnly,
    deriveOnly: options.deriveOnly,
    fetchOnly: options.fetchOnly,
  };

  if (format === 'json') {
    await executePricesEnrichJSON(params, appRuntime);
  } else {
    await executePricesEnrichTUI(params, appRuntime);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executePricesEnrichJSON(params: PricesEnrichOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('prices-enrich', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const result = await runPricesEnrich(
        ctx,
        {
          format: 'json',
          profileId: profileResult.value.id,
          profileKey: profileResult.value.profileKey,
        },
        params
      );
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
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('prices-enrich', profileResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const result = await runPricesEnrich(
        ctx,
        {
          format: 'text',
          profileId: profileResult.value.id,
          profileKey: profileResult.value.profileKey,
        },
        params
      );
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
