// Unified transactions command for managing processed transactions
// Provides a single namespace for viewing transaction data

import type { Command } from 'commander';

import { registerTransactionsViewCommand } from './transactions-view.ts';

/**
 * Register the unified transactions command with all subcommands.
 *
 * Structure:
 *   transactions view           - View processed transactions with filters
 */
export function registerTransactionsCommand(program: Command): void {
  const transactions = program
    .command('transactions')
    .description('Manage processed transactions (view transaction history)');

  // Register subcommands
  registerTransactionsViewCommand(transactions);
}
