import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerPricesEnrichCommand } from './prices-enrich.js';
import { registerPricesSetFxCommand } from './prices-set-fx.js';
import { registerPricesSetCommand } from './prices-set.js';
import { registerPricesViewCommand } from './prices-view.js';

/**
 * Register the unified prices command with all subcommands.
 *
 * Structure:
 *   prices view                 - View price coverage statistics
 *   prices enrich               - Unified enrichment pipeline (derive → normalize → fetch → re-derive)
 *   prices set                  - Manually set price for an asset
 *   prices set-fx               - Manually set FX rate between currencies
 */
export function registerPricesCommand(program: Command, appRuntime: CliAppRuntime): void {
  const prices = program
    .command('prices')
    .description('Manage cryptocurrency prices (view, enrich, set, set-fx)')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices view --missing-only
  $ exitbook prices enrich --asset BTC --asset ETH
  $ exitbook prices set --asset BTC --date 2024-01-15T10:30:00Z --price 45000.50
  $ exitbook prices set-fx --from CAD --to USD --date 2024-01-15T00:00:00Z --rate 0.74

Notes:
  - "prices set" and "prices set-fx" create manual overrides for the active profile.
  - Use "prices enrich" to fill gaps before portfolio or tax workflows.
`
    );

  registerPricesViewCommand(prices);
  registerPricesEnrichCommand(prices, appRuntime);
  registerPricesSetCommand(prices);
  registerPricesSetFxCommand(prices);
}
