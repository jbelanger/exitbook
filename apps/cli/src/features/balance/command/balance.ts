import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBalanceRefreshCommand } from './balance-refresh.js';
import { registerBalanceViewCommand } from './balance-view.js';

export function registerBalanceCommand(program: Command, appRuntime: CliAppRuntime): void {
  const balance = program
    .command('balance')
    .description('View stored balance snapshots or refresh live verification')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance view
  $ exitbook balance view kraken-main
  $ exitbook balance refresh
  $ exitbook balance refresh 6f4c0d1a2b --json

Notes:
  - "balance view" reads stored snapshots only.
  - "balance refresh" recalculates balances and verifies live data when providers support it.
`
    );

  registerBalanceViewCommand(balance, appRuntime);
  registerBalanceRefreshCommand(balance, appRuntime);
}
