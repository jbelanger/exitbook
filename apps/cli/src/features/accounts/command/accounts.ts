import { resultDoAsync } from '@exitbook/foundation';
import { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerAccountsAddCommand } from './accounts-add.js';
import {
  buildAccountsBrowseOptionsHelpText,
  executePreparedAccountsBrowseCommand,
  prepareAccountsBrowseCommand,
  registerAccountsBrowseOptions,
} from './accounts-browse-command.js';
import { registerAccountsExploreCommand } from './accounts-explore.js';
import { registerAccountsListCommand } from './accounts-list.js';
import { registerAccountsRefreshCommand } from './accounts-refresh.js';
import { registerAccountsRemoveCommand } from './accounts-remove.js';
import { registerAccountsUpdateCommand } from './accounts-update.js';
import { registerAccountsViewCommand } from './accounts-view.js';

const ACCOUNTS_COMMAND_ID = 'accounts';

/**
 * Register the unified accounts command with all subcommands.
 *
 * Structure:
 *   accounts                 - Static account list/table
 *   accounts list            - Explicit static account list alias
 *   accounts view <name>     - Static account detail card
 *   accounts explore [name]  - Accounts explorer
 *   accounts refresh [name]  - Refresh stored balances and verify live data
 *   accounts add             - Create an account
 *   accounts update          - Update account properties
 *   accounts remove          - Remove an account and all attached data
 */
export function registerAccountsCommand(program: Command, appRuntime: CliAppRuntime): void {
  const accounts = program
    .command('accounts')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse and manage accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts
  $ exitbook accounts list --platform kraken
  $ exitbook accounts view kraken-main
  $ exitbook accounts view 1a2b3c4d
  $ exitbook accounts explore
  $ exitbook accounts explore kraken-main
  $ exitbook accounts refresh
  $ exitbook accounts refresh kraken-main
  $ exitbook accounts --json

Browse Options:
${buildAccountsBrowseOptionsHelpText()}

Notes:
  - Use bare "accounts" or "accounts list" for quick account lists.
  - Use "accounts view <selector>" for one static account detail card.
  - Use "accounts explore" for the interactive explorer.
  - Use "accounts refresh" to rebuild stored balances and verify live data.
  - Account selectors may be account names or account fingerprint prefixes.
  - Account names cannot use reserved command words such as add, explore, list, refresh, remove, update, or view.
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

          if (accountSelector) {
            return yield* cliErr(
              new Error(
                `Use "accounts view ${accountSelector}" for static detail or ` +
                  `"accounts explore ${accountSelector}" for the explorer.`
              ),
              ExitCodes.INVALID_ARGS
            );
          }

          return yield* prepareAccountsBrowseCommand({
            commandId: ACCOUNTS_COMMAND_ID,
            rawOptions: parsedInvocation.rawOptions,
            surfaceSpec: staticListSurfaceSpec(ACCOUNTS_COMMAND_ID),
          });
        }),
      action: async (context) => executePreparedAccountsBrowseCommand(context.runtime, context.prepared),
    });
  });

  registerAccountsAddCommand(accounts, appRuntime);
  registerAccountsListCommand(accounts);
  registerAccountsViewCommand(accounts);
  registerAccountsExploreCommand(accounts);
  registerAccountsRefreshCommand(accounts, appRuntime);
  registerAccountsUpdateCommand(accounts, appRuntime);
  registerAccountsRemoveCommand(accounts);
}
