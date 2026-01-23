// Unified accounts command for managing accounts
// Provides a single namespace for viewing account data

import type { Command } from 'commander';

import { registerAccountsViewCommand } from './view-accounts.js';

/**
 * Register the unified accounts command with all subcommands.
 *
 * Structure:
 *   accounts view               - View accounts with filters
 */
export function registerAccountsCommand(program: Command): void {
  const accounts = program.command('accounts').description('Manage accounts (view account information)');

  registerAccountsViewCommand(accounts);
}
