import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import {
  executeLinksV2AssetIdentityAcceptCommand,
  executeLinksV2AssetIdentityListCommand,
  executeLinksV2RunCommand,
} from '../../links-v2/command/links-v2-shared.js';

const LEDGER_LINKING_V2_RUN_CONFIG = {
  commandId: 'ledger-linking-v2-run',
  title: 'Ledger linking v2 completed.',
} as const;

const LEDGER_LINKING_V2_ASSET_IDENTITY_CONFIG = {
  commandId: 'ledger-linking-v2-asset-identity',
  label: 'Ledger linking',
} as const;

export function registerLedgerLinkingV2Command(ledgerCommand: Command, appRuntime: CliAppRuntime): void {
  const linkingV2 = ledgerCommand
    .command('linking-v2')
    .description('Run ledger-native relationship linking migration commands')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 run
  $ exitbook ledger linking-v2 run --dry-run
  $ exitbook ledger linking-v2 run --json

Notes:
  - This is the ledger-native v2 path, not legacy transaction link proposal review.
  - Use "ledger linking-v2 run --dry-run" to preview accepted relationships before writing them.
  - Prefer "links-v2" for the parallel migration UX during v1/v2 comparison work.
`
    );

  linkingV2
    .command('run')
    .description('Run ledger-linking v2 for the active profile')
    .option('--dry-run', 'Preview accepted relationships without writing them')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 run
  $ exitbook ledger linking-v2 run --dry-run
  $ exitbook ledger linking-v2 run --json

Notes:
  - Non-TUI command.
  - Persists accepted ledger-linking relationships only unless --dry-run is set.
  - Does not create legacy transaction links, proposals, or gap issues.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2RunCommand(rawOptions, appRuntime, LEDGER_LINKING_V2_RUN_CONFIG);
    });

  registerLedgerLinkingV2AssetIdentityCommand(linkingV2, appRuntime);
}

function registerLedgerLinkingV2AssetIdentityCommand(linkingV2: Command, appRuntime: CliAppRuntime): void {
  const assetIdentity = linkingV2
    .command('asset-identity')
    .description('Manage accepted ledger-linking asset identity assertions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 asset-identity list
  $ exitbook ledger linking-v2 asset-identity accept --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native

Notes:
  - Assertions are pairwise and scoped to the active profile.
  - Assertions allow ledger-linking to treat different asset ids as equivalent for a relationship kind.
`
    );

  assetIdentity
    .command('list')
    .description('List accepted ledger-linking asset identity assertions for the active profile')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 asset-identity list
  $ exitbook ledger linking-v2 asset-identity list --json
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentityListCommand(rawOptions, appRuntime, {
        ...LEDGER_LINKING_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'ledger-linking-v2-asset-identity-list',
      });
    });

  assetIdentity
    .command('accept')
    .description('Accept one pairwise asset identity assertion for ledger-linking')
    .requiredOption('--asset-id-a <assetId>', 'First asset id in the pair')
    .requiredOption('--asset-id-b <assetId>', 'Second asset id in the pair')
    .option('--relationship-kind <kind>', 'Relationship kind scope', 'internal_transfer')
    .option('--evidence-kind <kind>', 'Assertion evidence kind', 'manual')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 asset-identity accept --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native
  $ exitbook ledger linking-v2 asset-identity accept --asset-id-a exchange:coinbase:btc --asset-id-b blockchain:bitcoin:native --json

Notes:
  - The pair is stored canonically; command input order does not matter.
  - Defaults to relationship kind "internal_transfer" and evidence kind "manual".
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentityAcceptCommand(rawOptions, appRuntime, {
        ...LEDGER_LINKING_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'ledger-linking-v2-asset-identity-accept',
      });
    });
}
