// Command registration for view commands
// Unified inspection interface for all data types

import type { Command } from 'commander';

import { registerViewLinksCommand } from './view-links.ts';
import { registerViewSessionsCommand } from './view-sessions.ts';
import { registerViewTransactionsCommand } from './view-transactions.ts';

/**
 * Register the view command with all subcommands.
 */
export function registerViewCommand(program: Command): void {
  const view = program.command('view').description('Inspect imported and processed data');

  // Register subcommands
  registerViewSessionsCommand(view);
  registerViewTransactionsCommand(view);
  registerViewLinksCommand(view);
}
