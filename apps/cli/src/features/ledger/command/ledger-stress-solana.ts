import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildSolanaLedgerStressHelpText,
  executeSolanaLedgerStressCommand,
} from './solana-ledger-stress-command-support.js';

export function registerLedgerStressSolanaCommand(stressCommand: Command, appRuntime: CliAppRuntime): void {
  stressCommand
    .command('solana')
    .description('Rerun Solana ledger-v2 processor and compare against legacy balance impact')
    .argument('[selector]', 'Account selector (name, fingerprint prefix, or address)')
    .option('--expected-diffs <path>', 'JSON file of documented expected diffs')
    .option('--json', 'Output results in JSON format')
    .addHelpText('after', buildSolanaLedgerStressHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeSolanaLedgerStressCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
