import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import {
  buildStoredBalanceRefreshHelpText,
  executeStoredBalanceRefreshCommand,
} from '../../balance/command/balance-refresh-command-support.js';

export function registerAccountsRefreshCommand(accountsCommand: Command, appRuntime: CliAppRuntime): void {
  accountsCommand
    .command('refresh')
    .description('Refresh stored balances and verify live data when providers support it')
    .argument('[selector]', 'Account selector (name or fingerprint prefix)')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      buildStoredBalanceRefreshHelpText({
        canonicalCommandPath: 'exitbook accounts refresh',
        examplesCommandPath: 'exitbook accounts refresh',
        preferCanonical: true,
      })
    )
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeStoredBalanceRefreshCommand({
        appRuntime,
        commandId: 'accounts-refresh',
        rawOptions,
        selector,
        selectorRequiredMessage: 'Accounts refresh requires an account selector',
      })
    );
}
