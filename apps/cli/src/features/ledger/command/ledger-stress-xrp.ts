import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { buildXrpLedgerStressHelpText, executeXrpLedgerStressCommand } from './xrp-ledger-stress-command-support.js';

export function registerLedgerStressXrpCommand(stressCommand: Command, appRuntime: CliAppRuntime): void {
  stressCommand
    .command('xrp')
    .description('Rerun XRP ledger-v2 processor and compare against legacy balance impact')
    .argument('[selector]', 'Account selector (name, fingerprint prefix, or address)')
    .option('--expected-diffs <path>', 'JSON file of documented expected diffs')
    .option('--json', 'Output results in JSON format')
    .addHelpText('after', buildXrpLedgerStressHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeXrpLedgerStressCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
