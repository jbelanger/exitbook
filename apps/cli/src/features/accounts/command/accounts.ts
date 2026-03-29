import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerAccountsAddCommand } from './accounts-add.js';
import { registerAccountsRemoveCommand } from './accounts-remove.js';
import { registerAccountsRenameCommand } from './accounts-rename.js';
import { registerAccountsUpdateCommand } from './accounts-update.js';
import { registerAccountsViewCommand } from './accounts-view.js';

/**
 * Register the unified accounts command with all subcommands.
 *
 * Structure:
 *   accounts add                - Create an account
 *   accounts view/list          - View accounts and hierarchy
 *   accounts update             - Update sync config for an account
 *   accounts rename             - Rename an account
 *   accounts remove             - Remove an account and all attached data
 */
export function registerAccountsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const accounts = program
    .command('accounts')
    .description('Manage accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts view
  $ exitbook accounts add kraken-main --exchange kraken --api-key KEY --api-secret SECRET
  $ exitbook accounts update wallet-main --provider blockchair
  $ exitbook accounts remove kraken-main

Notes:
  - Use "accounts list" as an alias for "accounts view".
  - Accounts are always scoped to the active profile.
`
    );

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsViewCommand(accounts);
  registerAccountsUpdateCommand(accounts, appRuntime);
  registerAccountsRenameCommand(accounts);
  registerAccountsRemoveCommand(accounts);
}
