// Unified prices command for managing cryptocurrency prices
// Provides a single namespace for price operations (view, enrich, set, set-fx)

import type { Command } from 'commander';

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
export function registerPricesCommand(program: Command): void {
  const prices = program.command('prices').description('Manage cryptocurrency prices (view, enrich, set, set-fx)');

  registerPricesViewCommand(prices);
  registerPricesEnrichCommand(prices);
  registerPricesSetCommand(prices);
  registerPricesSetFxCommand(prices);
}
