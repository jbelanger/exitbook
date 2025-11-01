// Unified prices command for managing cryptocurrency prices
// Provides a single namespace for price operations (view, derive, fetch)

import type { Command } from 'commander';

import { registerPricesDeriveCommand } from './prices-derive.ts';
import { registerPricesFetchCommand } from './prices-fetch.ts';
import { registerPricesViewCommand } from './prices-view.ts';

/**
 * Register the unified prices command with all subcommands.
 *
 * Structure:
 *   prices view                 - View price coverage statistics
 *   prices derive               - Derive prices from transaction history
 *   prices fetch                - Fetch prices from external providers
 */
export function registerPricesCommand(program: Command): void {
  const prices = program.command('prices').description('Manage cryptocurrency prices (view, derive, fetch)');

  // Register subcommands
  registerPricesViewCommand(prices);
  registerPricesDeriveCommand(prices);
  registerPricesFetchCommand(prices);
}
