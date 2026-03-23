import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerBalanceRefreshCommand } from './balance-refresh.js';
import { registerBalanceViewCommand } from './balance-view.js';

export function registerBalanceCommand(program: Command, appRuntime: CliAppRuntime): void {
  const balance = program.command('balance').description('View stored balance snapshots or refresh live verification');

  registerBalanceViewCommand(balance, appRuntime);
  registerBalanceRefreshCommand(balance, appRuntime);
}
