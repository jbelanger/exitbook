import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerTransactionsEditMovementRoleCommand } from './transactions-edit-movement-role.js';
import { registerTransactionsEditNoteCommand } from './transactions-edit-note.js';

/**
 * Register the transactions edit subcommand group.
 */
export function registerTransactionsEditCommand(transactionsCommand: Command, appRuntime: CliAppRuntime): void {
  const editCommand = transactionsCommand
    .command('edit')
    .description('Edit durable transaction overrides such as notes and movement roles')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions edit note a1b2c3d4e5 --message "Internal transfer"
  $ exitbook transactions edit note a1b2c3d4e5 --clear
  $ exitbook transactions edit movement-role a1b2c3d4e5 --movement 6c6545ac9a:1 --role staking_reward
  $ exitbook transactions edit note a1b2c3d4e5 --message "Cold storage withdrawal" --json

Notes:
  - Transaction edit commands use the TX-REF shown in transactions browse output.
  - Movement edit commands also use the MOVEMENT-REF shown in transaction detail output.
`
    );

  registerTransactionsEditNoteCommand(editCommand, appRuntime);
  registerTransactionsEditMovementRoleCommand(editCommand, appRuntime);
}
