import { resultDoAsync } from '@exitbook/foundation';
import { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticDetailSurfaceSpec, staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerAccountsAddCommand } from './accounts-add.js';
import {
  buildAccountsBrowseOptionsHelpText,
  executePreparedAccountsBrowseCommand,
  prepareAccountsBrowseCommand,
  registerAccountsBrowseOptions,
} from './accounts-browse-command.js';
import { registerAccountsRemoveCommand } from './accounts-remove.js';
import { registerAccountsRenameCommand } from './accounts-rename.js';
import { registerAccountsUpdateCommand } from './accounts-update.js';
import { registerAccountsViewCommand } from './accounts-view.js';

const ACCOUNTS_COMMAND_ID = 'accounts';
const ACCOUNTS_LIST_ALIAS = 'list';

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
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse and manage accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts
  $ exitbook accounts kraken-main
  $ exitbook accounts 1a2b3c4d
  $ exitbook accounts --platform kraken
  $ exitbook accounts view
  $ exitbook accounts view kraken-main
  $ exitbook accounts view 1a2b3c4d
  $ exitbook accounts --json

Browse Options:
${buildAccountsBrowseOptionsHelpText()}

Notes:
  - Use bare "accounts" for quick account lists and single-account details.
  - Use "accounts view" for the interactive explorer.
  - Bare selectors may be account names or account fingerprint prefixes.
  - Account selectors cannot use reserved command words such as add, list, remove, rename, update, or view.
`
    );

  accounts.action(async (tokens: string[] | undefined) => {
    await runCliRuntimeCommand({
      command: ACCOUNTS_COMMAND_ID,
      format: detectCliTokenOutputFormat(tokens),
      prepare: async () =>
        resultDoAsync(async function* () {
          const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerAccountsBrowseOptions);
          const accountSelector = parsedInvocation.selector?.trim();

          if (accountSelector?.toLowerCase() === ACCOUNTS_LIST_ALIAS) {
            return yield* cliErr(new Error('Use bare "accounts" instead of "accounts list".'), ExitCodes.INVALID_ARGS);
          }

          return yield* prepareAccountsBrowseCommand({
            accountSelector,
            commandId: ACCOUNTS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: accountSelector
              ? staticDetailSurfaceSpec(ACCOUNTS_COMMAND_ID)
              : staticListSurfaceSpec(ACCOUNTS_COMMAND_ID),
          });
        }),
      action: async (context) => executePreparedAccountsBrowseCommand(context.runtime, context.prepared),
    });
  });

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsViewCommand(accounts);
  registerAccountsUpdateCommand(accounts, appRuntime);
  registerAccountsRenameCommand(accounts);
  registerAccountsRemoveCommand(accounts);
}
