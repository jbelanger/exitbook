import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerLedgerLinkingV2Command } from './ledger-linking-v2.js';
import { registerLedgerStressEvmFamilyCommand } from './ledger-stress-evm-family.js';
import { registerLedgerStressNearCommand } from './ledger-stress-near.js';
import { registerLedgerStressSolanaCommand } from './ledger-stress-solana.js';
import { registerLedgerStressXrpCommand } from './ledger-stress-xrp.js';

export function registerLedgerCommand(program: Command, appRuntime: CliAppRuntime): void {
  const ledger = program
    .command('ledger')
    .description('Inspect, validate, and run accounting ledger migration workflows')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 run
  $ exitbook ledger linking-v2 run --json
  $ exitbook ledger stress evm-family
  $ exitbook ledger stress evm-family ethereum-main --json
  $ exitbook ledger stress near alice.near --json
  $ exitbook ledger stress solana solana-wallet-1 --json
  $ exitbook ledger stress xrp xrp-wallet-1 --json

Notes:
  - Ledger stress commands are read-only migration validation surfaces.
  - Ledger linking-v2 materializes accepted accounting journal relationships.
  - Use "ledger linking-v2 run" for the new ledger-native linker.
  - Use "ledger stress evm-family", "ledger stress near", "ledger stress solana", and "ledger stress xrp" before ledger consumer cutover work.
`
    );

  const stress = ledger
    .command('stress')
    .description('Run repeatable ledger migration stress checks')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger stress evm-family
  $ exitbook ledger stress near
  $ exitbook ledger stress solana
  $ exitbook ledger stress xrp
`
    );

  registerLedgerStressEvmFamilyCommand(stress, appRuntime);
  registerLedgerStressNearCommand(stress, appRuntime);
  registerLedgerStressSolanaCommand(stress, appRuntime);
  registerLedgerStressXrpCommand(stress, appRuntime);
  registerLedgerLinkingV2Command(ledger, appRuntime);
}
