import type { Command } from 'commander';

import { staticDetailSurfaceSpec } from '../../../cli/presentation.js';

import { registerAccountsBrowseOptions, runAccountsBrowseCommand } from './accounts-browse-command.js';

const ACCOUNTS_VIEW_COMMAND_ID = 'accounts-view';

export function registerAccountsViewCommand(accountsCommand: Command): void {
  registerAccountsBrowseOptions(
    accountsCommand
      .command('view <selector>')
      .description('Show static detail for one account')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook accounts view kraken-main
  $ exitbook accounts view 1a2b3c4d
  $ exitbook accounts view kraken-main --show-sessions
  $ exitbook accounts view kraken-main --json

Common Usage:
  - Inspect one account and its stored balance snapshot
  - Check import history for one account
  - Use "exitbook accounts explore" when you want navigation instead of one-off detail
  - Use "exitbook accounts refresh" to rebuild and verify balances

Notes:
  - Selectors accept account names and the ACCT-REF shown in the accounts list.

Account Types:
  blockchain, exchange-api, exchange-csv
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAccountsBrowseCommand({
      accountSelector: selector,
      commandId: ACCOUNTS_VIEW_COMMAND_ID,
      rawOptions,
      surfaceSpec: staticDetailSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID),
    });
  });
}
