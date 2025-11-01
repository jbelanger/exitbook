// Command registration for view commands
// Unified inspection interface for all data types

import type { Command } from 'commander';

import { registerViewPricesCommand } from './view-prices.ts';
import { registerViewSessionsCommand } from './view-sessions.ts';
import { registerViewTransactionsCommand } from './view-transactions.ts';

/**
 * Register the view command with all subcommands.
 * Note: view links moved to links view subcommand
 */
export function registerViewCommand(program: Command): void {
  const view = program.command('view').description('Inspect imported and processed data');

  // Register subcommands
  registerViewSessionsCommand(view);
  registerViewTransactionsCommand(view);
  registerViewPricesCommand(view);
}
