import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { buildNearLedgerStressHelpText, executeNearLedgerStressCommand } from './near-ledger-stress-command-support.js';

export function registerLedgerStressNearCommand(stressCommand: Command, appRuntime: CliAppRuntime): void {
  stressCommand
    .command('near')
    .description('Rerun NEAR ledger-v2 processor and compare against legacy balance impact')
    .argument('[selector]', 'Account selector (name, fingerprint prefix, or address)')
    .option('--expected-diffs <path>', 'JSON file of documented expected diffs')
    .option('--json', 'Output results in JSON format')
    .addHelpText('after', buildNearLedgerStressHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeNearLedgerStressCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
