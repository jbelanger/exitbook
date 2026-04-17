import type { Command } from 'commander';

import { registerTransactionsBrowseOptions, runTransactionsBrowseCommand } from './transactions-browse-command.js';

export function registerTransactionsViewCommand(transactionsCommand: Command): void {
  registerTransactionsBrowseOptions(
    transactionsCommand
      .command('view <selector>')
      .description('Show static detail for one processed transaction')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook transactions view a1b2c3d4e5
  $ exitbook transactions view a1b2c3d4e5 --source-data
  $ exitbook transactions view a1b2c3d4e5 --json

Notes:
  - Transaction selectors use the TX-REF shown in the transactions list.
  - Use "transactions explore" when you want the interactive explorer.
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runTransactionsBrowseCommand({
      commandId: 'transactions-view',
      rawOptions,
      transactionSelector: selector,
    });
  });
}
