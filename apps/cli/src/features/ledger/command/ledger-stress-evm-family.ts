import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildEvmFamilyLedgerStressHelpText,
  executeEvmFamilyLedgerStressCommand,
} from './evm-family-ledger-stress-command-support.js';

export function registerLedgerStressEvmFamilyCommand(stressCommand: Command, appRuntime: CliAppRuntime): void {
  stressCommand
    .command('evm-family')
    .description('Rerun EVM-family ledger-v2 processors and compare against legacy balance impact')
    .argument('[selector]', 'Account selector (name, fingerprint prefix, or address)')
    .option('--chains <chains>', 'Comma-separated chain filter, for example ethereum,arbitrum,avalanche,theta')
    .option('--expected-diffs <path>', 'JSON file of documented expected diffs')
    .option('--json', 'Output results in JSON format')
    .addHelpText('after', buildEvmFamilyLedgerStressHelpText())
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeEvmFamilyLedgerStressCommand({
        appRuntime,
        rawOptions,
        selector,
      })
    );
}
