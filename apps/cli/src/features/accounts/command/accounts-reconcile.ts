import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildAccountsReconcileHelpText,
  executeAccountsReconcileCommand,
} from './accounts-reconcile-command-support.js';

export function registerAccountsReconcileCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('reconcile')
    .description('Compare ledger balances against stored or live reference balances')
    .argument('[selector]', 'Account selector (name, fingerprint prefix, or address)')
    .option('--json', 'Output results in JSON format')
    .option('--reference <source>', 'Reference source: stored or live', 'stored')
    .option('--refresh-live', 'Refresh live balances before reconciling')
    .option('--all', 'Include matched rows in text output')
    .option('--strict', 'Exit non-zero when any selected scope is not fully matched')
    .option('--tolerance <quantity>', 'Quantity tolerance for matched rows')
    .addHelpText('after', buildAccountsReconcileHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeAccountsReconcileCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
