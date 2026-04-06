import type { Command } from 'commander';

import { staticListSurfaceSpec } from '../../../cli/presentation.js';

import { registerAccountsBrowseOptions, runAccountsBrowseCommand } from './accounts-browse-command.js';

export function registerAccountsListCommand(accountsCommand: Command): void {
  registerAccountsBrowseOptions(
    accountsCommand
      .command('list')
      .description('Show a static list of accounts')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook accounts list
  $ exitbook accounts list --platform kraken
  $ exitbook accounts list --type blockchain
  $ exitbook accounts list --show-sessions
  $ exitbook accounts list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runAccountsBrowseCommand({
      commandId: 'accounts-list',
      rawOptions,
      surfaceSpec: staticListSurfaceSpec('accounts-list'),
    });
  });
}
