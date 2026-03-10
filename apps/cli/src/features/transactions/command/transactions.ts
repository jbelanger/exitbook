// Unified transactions command for managing processed transactions
// Provides a single namespace for viewing and exporting transaction data

import type { Command } from 'commander';

import { registerTransactionsExportCommand } from './transactions-export.js';
import { registerTransactionsViewCommand } from './transactions-view.js';

/**
 * Register the unified transactions command with all subcommands.
 *
 * Structure:
 *   transactions view           - View processed transactions with filters
 *   transactions export         - Export all transactions to CSV or JSON
 */
export function registerTransactionsCommand(program: Command): void {
  const transactions = program
    .command('transactions')
    .description('Manage processed transactions (view and export transaction history)');

  registerTransactionsViewCommand(transactions);
  registerTransactionsExportCommand(transactions);
}
