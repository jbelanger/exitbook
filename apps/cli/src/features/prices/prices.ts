// Unified prices command for managing cryptocurrency prices
// Provides a single namespace for price operations (view, enrich, derive, fetch)

import type { Command } from 'commander';

import { registerPricesDeriveCommand } from './prices-derive.ts';
import { registerPricesEnrichCommand } from './prices-enrich.ts';
import { registerPricesFetchCommand } from './prices-fetch.ts';
import { registerPricesViewCommand } from './prices-view.ts';

/**
 * Register the unified prices command with all subcommands.
 *
 * Structure:
 *   prices view                 - View price coverage statistics
 *   prices enrich               - Unified enrichment pipeline (normalize → derive → fetch)
 *   prices derive               - Derive prices from transaction history
 *   prices fetch                - Fetch prices from external providers
 */
export function registerPricesCommand(program: Command): void {
  const prices = program.command('prices').description('Manage cryptocurrency prices (view, enrich, derive, fetch)');

  // Register subcommands
  registerPricesViewCommand(prices);
  registerPricesEnrichCommand(prices); // NEW - primary workflow
  registerPricesDeriveCommand(prices); // Keep for granular control
  registerPricesFetchCommand(prices); // Keep for granular control
}
