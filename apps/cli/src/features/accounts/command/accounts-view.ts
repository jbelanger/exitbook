import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';

import { registerAccountsBrowseOptions, runAccountsBrowseCommand } from './accounts-browse-command.js';

const ACCOUNTS_VIEW_COMMAND_ID = 'accounts-view';

export function registerAccountsViewCommand(accountsCommand: Command): void {
  registerAccountsBrowseOptions(
    accountsCommand
      .command('view [selector]')
      .description('Open the accounts explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook accounts view                        # Open the full accounts explorer
  $ exitbook accounts view kraken-main            # Open the explorer focused on a named account
  $ exitbook accounts view 1a2b3c4d               # Open the explorer focused on a fingerprint ref
  $ exitbook accounts view --platform kraken      # Explore Kraken accounts
  $ exitbook accounts view --type blockchain      # Explore blockchain accounts only
  $ exitbook accounts view --show-sessions        # Include session details for each account
  $ exitbook accounts view --json                 # Output JSON

Common Usage:
  - Monitor account verification status
  - Check last stored balance refresh timestamp
  - Use "exitbook accounts refresh" to rebuild and verify balances
  - Review account activity and import history
  - Identify which platforms have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAccountsBrowseCommand({
      accountSelector: selector,
      commandId: ACCOUNTS_VIEW_COMMAND_ID,
      rawOptions,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID)
        : explorerListSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID),
    });
  });
}
