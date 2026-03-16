import type { Command } from 'commander';

import { registerTransactionsEditNoteCommand } from './transactions-edit-note.js';

/**
 * Register the transactions edit subcommand group.
 */
export function registerTransactionsEditCommand(transactionsCommand: Command): void {
  const editCommand = transactionsCommand
    .command('edit')
    .description('Edit durable transaction overrides such as notes');

  registerTransactionsEditNoteCommand(editCommand);
}
