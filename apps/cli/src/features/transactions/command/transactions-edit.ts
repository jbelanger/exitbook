import type { Command } from 'commander';

import { registerTransactionsEditNoteCommand } from './transactions-edit-note.js';

/**
 * Register the transactions edit subcommand group.
 */
export function registerTransactionsEditCommand(transactionsCommand: Command): void {
  const editCommand = transactionsCommand
    .command('edit')
    .description('Edit durable transaction overrides such as notes')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions edit note a1b2c3d4e5 --message "Internal transfer"
  $ exitbook transactions edit note a1b2c3d4e5 --clear
  $ exitbook transactions edit note a1b2c3d4e5 --message "Cold storage withdrawal" --json

Notes:
  - Transaction edit commands use the TX-REF shown in transactions browse output.
  - "note" is currently the supported durable override under "transactions edit".
`
    );

  registerTransactionsEditNoteCommand(editCommand);
}
