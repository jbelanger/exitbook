import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerTransactionsBrowseOptions, runTransactionsBrowseCommand } from './transactions-browse-command.js';

export function registerTransactionsListCommand(transactionsCommand: Command, appRuntime: CliAppRuntime): void {
  registerTransactionsBrowseOptions(
    transactionsCommand
      .command('list')
      .description('Show a static list of processed transactions')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook transactions list
  $ exitbook transactions list --account wallet-main
  $ exitbook transactions list --platform kraken
  $ exitbook transactions list --asset BTC
  $ exitbook transactions list --since 2024-01-01
  $ exitbook transactions list --json
`
      )
  ).action(async (rawOptions: unknown) => {
    await runTransactionsBrowseCommand({
      appRuntime,
      commandId: 'transactions-list',
      rawOptions,
    });
  });
}
