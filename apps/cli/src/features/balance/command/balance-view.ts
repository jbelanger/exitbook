import type { Command } from 'commander';

import { registerBalanceBrowseOptions, runBalanceViewBrowseCommand } from './balance-browse-command.js';

const BALANCE_VIEW_COMMAND_ID = 'balance-view';

export function registerBalanceViewCommand(balanceCommand: Command): void {
  registerBalanceBrowseOptions(
    balanceCommand
      .command('view [selector]')
      .description('Open the stored balances explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook balance view
  $ exitbook balance view kraken-main
  $ exitbook balance view 6f4c0d1a2b
  $ exitbook balance view --json

Notes:
  - Reads stored balance snapshots only.
  - Reprocesses derived transactions automatically if they are missing or stale.
  - Rebuilds stored calculated snapshots automatically when they are missing or stale.
  - Does not fetch live balances.
  - Use "exitbook balance refresh" when you want live verification.
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runBalanceViewBrowseCommand({
      accountSelector: selector,
      rawOptions,
    });
  });
}

export { BALANCE_VIEW_COMMAND_ID };
