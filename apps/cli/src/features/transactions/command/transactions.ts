// Unified transactions command for managing processed transactions
// Provides a single namespace for viewing, editing, and exporting transaction data

import type { Command } from 'commander';

import { registerTransactionsEditCommand } from './transactions-edit.js';
import { registerTransactionsExportCommand } from './transactions-export.js';
import { registerTransactionsViewCommand } from './transactions-view.js';

/**
 * Register the unified transactions command with all subcommands.
 *
 * Structure:
 *   transactions view           - View processed transactions with filters
 *   transactions edit note      - Set or clear durable transaction notes
 *   transactions export         - Export all transactions to CSV or JSON
 */
export function registerTransactionsCommand(program: Command): void {
  const transactions = program
    .command('transactions')
    .description('Manage processed transactions (view, edit, and export transaction history)');

  registerTransactionsViewCommand(transactions);
  registerTransactionsEditCommand(transactions);
  registerTransactionsExportCommand(transactions);
}
