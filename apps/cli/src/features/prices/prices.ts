// Unified prices command for managing cryptocurrency prices
// Provides a single namespace for price operations (view, enrich)

import type { Command } from 'commander';

import { registerPricesEnrichCommand } from './prices-enrich.ts';
import { registerPricesViewCommand } from './prices-view.ts';

/**
 * Register the unified prices command with all subcommands.
 *
 * Structure:
 *   prices view                 - View price coverage statistics
 *   prices enrich               - Unified enrichment pipeline (derive → normalize → fetch → re-derive)
 */
export function registerPricesCommand(program: Command): void {
  const prices = program.command('prices').description('Manage cryptocurrency prices (view, enrich)');

  // Register subcommands
  registerPricesViewCommand(prices);
  registerPricesEnrichCommand(prices);
}
