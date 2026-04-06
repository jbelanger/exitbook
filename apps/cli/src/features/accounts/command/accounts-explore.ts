import type { Command } from 'commander';

import { explorerDetailSurfaceSpec, explorerListSurfaceSpec } from '../../../cli/presentation.js';

import { registerAccountsBrowseOptions, runAccountsBrowseCommand } from './accounts-browse-command.js';

const ACCOUNTS_EXPLORE_COMMAND_ID = 'accounts-explore';

export function registerAccountsExploreCommand(accountsCommand: Command): void {
  registerAccountsBrowseOptions(
    accountsCommand
      .command('explore [selector]')
      .description('Open the accounts explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook accounts explore
  $ exitbook accounts explore kraken-main
  $ exitbook accounts explore 1a2b3c4d
  $ exitbook accounts explore --platform kraken
  $ exitbook accounts explore --type blockchain
  $ exitbook accounts explore --show-sessions
  $ exitbook accounts explore --json

Common Usage:
  - Monitor account verification status
  - Check last stored balance refresh timestamps
  - Review account activity and import history
  - Identify which platforms have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runAccountsBrowseCommand({
      accountSelector: selector,
      commandId: ACCOUNTS_EXPLORE_COMMAND_ID,
      rawOptions,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec(ACCOUNTS_EXPLORE_COMMAND_ID)
        : explorerListSurfaceSpec(ACCOUNTS_EXPLORE_COMMAND_ID),
    });
  });
}
