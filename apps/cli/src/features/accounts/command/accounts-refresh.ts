import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { buildAccountsRefreshHelpText, executeAccountsRefreshCommand } from './accounts-refresh-command-support.js';

export function registerAccountsRefreshCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('refresh')
    .description('Refresh stored balances and verify live data when providers support it')
    .argument('[selector]', 'Account selector (name or fingerprint prefix)')
    .option('--json', 'Output results in JSON format')
    .addHelpText('after', buildAccountsRefreshHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeAccountsRefreshCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
