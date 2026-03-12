import type { Command } from 'commander';

import { registerBalanceRefreshCommand } from './balance-refresh.js';
import { registerBalanceViewCommand } from './balance-view.js';

export function registerBalanceCommand(program: Command): void {
  const balance = program.command('balance').description('View stored balance snapshots or refresh live verification');

  registerBalanceViewCommand(balance);
  registerBalanceRefreshCommand(balance);
}
