import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { buildBalanceBrowseOptionsHelpText, runBalanceRootBrowseCommand } from './balance-browse-command.js';
import { registerBalanceRefreshCommand } from './balance-refresh.js';
import { registerBalanceViewCommand } from './balance-view.js';

export function registerBalanceCommand(program: Command, appRuntime: CliAppRuntime): void {
  const balance = program
    .command('balance')
    .usage('[selector] [options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Browse stored balance snapshots or refresh live verification')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance
  $ exitbook balance kraken-main
  $ exitbook balance view
  $ exitbook balance view kraken-main
  $ exitbook accounts refresh
  $ exitbook accounts refresh 6f4c0d1a2b --json

Browse Options:
${buildBalanceBrowseOptionsHelpText()}

Notes:
  - Use bare "balance" for quick stored-snapshot lists and single-account details.
  - "balance view" reads stored snapshots only.
  - "balance view" opens the explorer on interactive terminals and falls back to the same static output off-TTY.
  - Use "accounts refresh" for balance refresh workflows.
  - "balance refresh" remains supported as a compatibility alias.
`
    );

  balance.action(async (tokens: string[] | undefined) => {
    await runBalanceRootBrowseCommand(tokens);
  });

  registerBalanceViewCommand(balance);
  registerBalanceRefreshCommand(balance, appRuntime);
}
