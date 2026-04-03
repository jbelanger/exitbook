import type { Command } from 'commander';

import { buildBalanceBrowseOptionsHelpText, runBalanceRootBrowseCommand } from './balance-browse-command.js';
import { registerBalanceViewCommand } from './balance-view.js';

export function registerBalanceCommand(program: Command): void {
  const balance = program
    .command('balance')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse stored balance snapshots')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance
  $ exitbook balance kraken-main
  $ exitbook balance view
  $ exitbook balance view kraken-main

Browse Options:
${buildBalanceBrowseOptionsHelpText()}

Notes:
  - Use bare "balance" for quick stored-snapshot lists and single-account details.
  - "balance view" reads stored snapshots only.
  - "balance view" opens the explorer on interactive terminals and falls back to the same static output off-TTY.
  - Use "accounts refresh" to rebuild stored balances and verify live data.
`
    );

  balance.action(async (tokens: string[] | undefined) => {
    await runBalanceRootBrowseCommand(tokens);
  });

  registerBalanceViewCommand(balance);
}
