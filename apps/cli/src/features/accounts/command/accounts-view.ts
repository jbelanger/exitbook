import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../shared/presentation/browse-surface.js';

import { executeAccountsBrowseCommand, registerAccountsBrowseOptions } from './accounts-browse-command.js';

const ACCOUNTS_VIEW_COMMAND_ID = 'accounts-view';

export function registerAccountsViewCommand(accountsCommand: Command): void {
  registerAccountsBrowseOptions(
    accountsCommand
      .command('view [name]')
      .description('Open the accounts explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook accounts view                        # Open the full accounts explorer
  $ exitbook accounts view kraken-main            # Open the explorer focused on a specific account
  $ exitbook accounts view --platform kraken      # Explore Kraken accounts
  $ exitbook accounts view --account-id 1         # Open a filtered explorer by account ID
  $ exitbook accounts view --type blockchain      # Explore blockchain accounts only
  $ exitbook accounts view --show-sessions        # Include session details for each account
  $ exitbook accounts view --json                 # Output JSON

Common Usage:
  - Monitor account verification status
  - Check last stored balance refresh timestamp
  - Review account activity and import history
  - Identify which platforms have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
      )
  ).action(async (name: string | undefined, rawOptions: unknown) => {
    await executeAccountsBrowseCommand({
      accountName: name,
      commandId: ACCOUNTS_VIEW_COMMAND_ID,
      rawOptions,
      surfaceSpec: name
        ? explorerDetailSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID)
        : explorerListSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID),
    });
  });
}
