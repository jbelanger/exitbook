import { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { parseCliBrowseRootInvocation } from '../../shared/command-options.js';
import { staticDetailSurfaceSpec, staticListSurfaceSpec } from '../../shared/presentation/browse-surface.js';

import { registerAccountsAddCommand } from './accounts-add.js';
import {
  buildAccountsBrowseOptionsHelpText,
  executeAccountsBrowseCommand,
  registerAccountsBrowseOptions,
} from './accounts-browse-command.js';
import { registerAccountsRemoveCommand } from './accounts-remove.js';
import { registerAccountsRenameCommand } from './accounts-rename.js';
import { registerAccountsUpdateCommand } from './accounts-update.js';
import { registerAccountsViewCommand } from './accounts-view.js';

const ACCOUNTS_COMMAND_ID = 'accounts';
const LEGACY_ACCOUNTS_LIST_ALIAS = 'list';

/**
 * Register the unified accounts command with all subcommands.
 *
 * Structure:
 *   accounts                 - Static account list/table
 *   accounts <name>          - Static account detail card
 *   accounts view [name]     - Accounts explorer
 *   accounts add             - Create an account
 *   accounts update          - Update sync config for an account
 *   accounts rename          - Rename an account
 *   accounts remove          - Remove an account and all attached data
 */
export function registerAccountsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const accounts = program
    .command('accounts')
    .usage('[name] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse and manage accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts
  $ exitbook accounts kraken-main
  $ exitbook accounts --platform kraken
  $ exitbook accounts view
  $ exitbook accounts view kraken-main
  $ exitbook accounts --json

Browse Options:
${buildAccountsBrowseOptionsHelpText()}

Notes:
  - Use bare "accounts" for quick account lists and single-account details.
  - Use "accounts view" for the interactive explorer.
  - Account selectors cannot use reserved command words such as add, list, remove, rename, update, or view.
`
    );

  accounts.action(async (tokens: string[] | undefined) => {
    const parsedInvocation = parseCliBrowseRootInvocation(ACCOUNTS_COMMAND_ID, tokens, registerAccountsBrowseOptions);
    const accountName = normalizeAccountsRootSelector(parsedInvocation.selector);

    await executeAccountsBrowseCommand({
      accountName,
      commandId: ACCOUNTS_COMMAND_ID,
      rawOptions: parsedInvocation.rawOptions,
      surfaceSpec: accountName
        ? staticDetailSurfaceSpec(ACCOUNTS_COMMAND_ID)
        : staticListSurfaceSpec(ACCOUNTS_COMMAND_ID),
    });
  });

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsViewCommand(accounts);
  registerAccountsUpdateCommand(accounts, appRuntime);
  registerAccountsRenameCommand(accounts);
  registerAccountsRemoveCommand(accounts);
}

function normalizeAccountsRootSelector(accountName: string | undefined): string | undefined {
  if (!accountName) {
    return undefined;
  }

  return accountName.trim().toLowerCase() === LEGACY_ACCOUNTS_LIST_ALIAS ? undefined : accountName;
}
