import type { Command } from 'commander';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import { registerLinksV2RelationshipCommands } from './links-v2-relationships.js';
import {
  executeLinksV2AssetIdentityAcceptCommand,
  executeLinksV2AssetIdentityListCommand,
  executeLinksV2AssetIdentityRevokeCommand,
  executeLinksV2AssetIdentitySuggestionsCommand,
  executeLinksV2DiagnoseCommand,
  executeLinksV2ReviewAcceptCommand,
  executeLinksV2ReviewCommand,
  executeLinksV2ReviewRevokeCommand,
  executeLinksV2ReviewViewCommand,
  executeLinksV2RunCommand,
} from './links-v2-shared.js';

const LINKS_V2_MIGRATION_NOTE = 'Legacy transaction links: untouched.';

const LINKS_V2_STATUS_CONFIG = {
  commandId: 'links-v2-status',
  forceDryRun: true,
  title: 'Links v2 status.',
  migrationNote: LINKS_V2_MIGRATION_NOTE,
} as const;

const LINKS_V2_RUN_CONFIG = {
  commandId: 'links-v2-run',
  title: 'Links v2 run completed.',
  migrationNote: LINKS_V2_MIGRATION_NOTE,
} as const;

const LINKS_V2_DIAGNOSE_CONFIG = {
  commandId: 'links-v2-diagnose',
  title: 'Links v2 diagnostics.',
} as const;

const LINKS_V2_REVIEW_CONFIG = {
  commandId: 'links-v2-review',
  title: 'Links v2 review queue.',
} as const;

const LINKS_V2_REVIEW_ACCEPT_CONFIG = {
  commandId: 'links-v2-review-accept',
  title: 'Links v2 review item accepted.',
} as const;

const LINKS_V2_REVIEW_REVOKE_CONFIG = {
  commandId: 'links-v2-review-revoke',
  title: 'Links v2 review decision revoked.',
} as const;

const LINKS_V2_REVIEW_VIEW_CONFIG = {
  commandId: 'links-v2-review-view',
  title: 'Links v2 review item.',
} as const;

const LINKS_V2_ASSET_IDENTITY_CONFIG = {
  commandId: 'links-v2-asset-identity',
  commandPath: 'links-v2',
  label: 'Links v2',
} as const;

export function registerLinksV2Command(program: Command, appRuntime: CliAppRuntime): void {
  const linksV2 = program
    .command('links-v2')
    .description('Run the parallel ledger-native link migration workflow')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2
  $ exitbook links-v2 status
  $ exitbook links-v2 list
  $ exitbook links-v2 view 42
  $ exitbook links-v2 diagnose
  $ exitbook links-v2 review
  $ exitbook links-v2 run --dry-run
  $ exitbook links-v2 run
  $ exitbook links-v2 asset-identity list
  $ exitbook links-v2 asset-identity suggestions
  $ exitbook links-v2 asset-identity accept --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native

Notes:
  - Bare "links-v2" is read-only and behaves like "links-v2 status".
  - The legacy "links" command remains the v1 proposal, review, and gaps workflow.
  - This command writes only ledger-native relationships when "links-v2 run" is used without --dry-run.
  - It does not create, modify, or delete legacy transaction links.
`
    );

  linksV2
    .command('status', { isDefault: true })
    .description('Preview ledger-native link coverage without writing relationships')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 status
  $ exitbook links-v2 status --json

Notes:
  - Always runs in dry-run mode.
  - Use this while comparing v1 links with v2 ledger relationships.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2RunCommand(rawOptions, appRuntime, LINKS_V2_STATUS_CONFIG);
    });

  registerLinksV2RelationshipCommands(linksV2, appRuntime);

  linksV2
    .command('diagnose')
    .description('Inspect unmatched v2 candidates and read-only amount/time proposal evidence')
    .option('--limit <count>', 'Limit unmatched groups and proposal examples shown', '10')
    .option('--proposal-window-hours <hours>', 'Maximum amount/time proposal window in hours', '168')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 diagnose
  $ exitbook links-v2 diagnose --limit 20
  $ exitbook links-v2 diagnose --proposal-window-hours 24 --json

Notes:
  - Always runs in dry-run mode.
  - Amount/time proposals are diagnostic evidence only; they are not persisted as ledger relationships.
  - Candidate remainders are quantity-aware, so partially allocated postings still appear with remaining quantity.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2DiagnoseCommand(rawOptions, appRuntime, LINKS_V2_DIAGNOSE_CONFIG);
    });

  const review = linksV2
    .command('review')
    .description('Show pending v2 linking review items without writing relationships')
    .option('--limit <count>', 'Limit review items shown', '20')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 review
  $ exitbook links-v2 review --limit 10
  $ exitbook links-v2 review view ai_055f73938f17
  $ exitbook links-v2 review accept ai_055f73938f17
  $ exitbook links-v2 review --json

Notes:
  - Always runs in dry-run mode.
  - Shows the linking action queue: asset identity suggestions and reviewed link proposals.
  - Accept persists user decisions as override events before materializing projections.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2ReviewCommand(rawOptions, appRuntime, LINKS_V2_REVIEW_CONFIG);
    });

  review
    .command('view')
    .description('Inspect one pending v2 linking review item')
    .argument('<review-id>', 'Stable review id shown by "links-v2 review"')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 review view ai_055f73938f17
  $ exitbook links-v2 review view ai_055f73938f17 --json

Notes:
  - Always runs in dry-run mode.
  - Shows detailed evidence and decision help before accepting an item.
`
    )
    .action(async (reviewId: string, rawOptions: unknown, command: Command) => {
      await executeLinksV2ReviewViewCommand(
        reviewId,
        mergeReviewChildOptions(rawOptions, command),
        appRuntime,
        LINKS_V2_REVIEW_VIEW_CONFIG
      );
    });

  review
    .command('accept')
    .description('Accept one pending v2 linking review item')
    .argument('<review-id>', 'Stable review id shown by "links-v2 review"')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 review accept ai_055f73938f17
  $ exitbook links-v2 review accept ai_055f73938f17 --json

Notes:
  - Asset identity accepts record durable pairwise assertions.
  - Link proposal accepts record durable reviewed relationship overrides and rerun links-v2 materialization.
`
    )
    .action(async (reviewId: string, rawOptions: unknown, command: Command) => {
      await executeLinksV2ReviewAcceptCommand(
        reviewId,
        mergeReviewChildOptions(rawOptions, command),
        appRuntime,
        LINKS_V2_REVIEW_ACCEPT_CONFIG
      );
    });

  review
    .command('revoke')
    .description('Revoke one accepted v2 linking review decision')
    .argument('<target-kind>', 'Accepted decision kind: relationship or gap-resolution')
    .argument('<target-id>', 'Relationship stable key, or posting fingerprint for a gap resolution')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 review revoke relationship ledger-linking:reviewed_relationship:v2:abc123
  $ exitbook links-v2 review revoke gap-resolution ledger_posting:v1:abc123
  $ exitbook links-v2 review revoke relationship ledger-linking:reviewed_relationship:v2:abc123 --json

Notes:
  - Relationship revokes affect reviewed relationship overrides only.
  - Gap-resolution revokes reopen a posting as unresolved link work.
`
    )
    .action(async (targetKind: string, targetId: string, rawOptions: unknown, command: Command) => {
      await executeLinksV2ReviewRevokeCommand(
        targetKind,
        targetId,
        mergeReviewChildOptions(rawOptions, command),
        appRuntime,
        LINKS_V2_REVIEW_REVOKE_CONFIG
      );
    });

  linksV2
    .command('run')
    .description('Run ledger-native link materialization for the active profile')
    .option('--dry-run', 'Preview accepted relationships without writing them')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 run --dry-run
  $ exitbook links-v2 run
  $ exitbook links-v2 run --json

Notes:
  - Persists accepted ledger-native relationships only unless --dry-run is set.
  - The v1 "links" command remains available for proposal review and comparison.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2RunCommand(rawOptions, appRuntime, LINKS_V2_RUN_CONFIG);
    });

  registerLinksV2AssetIdentityCommand(linksV2, appRuntime);
}

function mergeReviewChildOptions(rawOptions: unknown, command: Command): Record<string, unknown> {
  return {
    ...command.parent?.opts(),
    ...(typeof rawOptions === 'object' && rawOptions !== null ? (rawOptions as Record<string, unknown>) : {}),
  };
}

function registerLinksV2AssetIdentityCommand(linksV2: Command, appRuntime: CliAppRuntime): void {
  const assetIdentity = linksV2
    .command('asset-identity')
    .description('Manage accepted v2 asset identity assertions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 asset-identity list
  $ exitbook links-v2 asset-identity suggestions
  $ exitbook links-v2 asset-identity accept --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native

Notes:
  - Assertions are pairwise and scoped to the active profile.
  - Assertions allow v2 linking to treat different asset ids as equivalent for a relationship kind.
  - Suggestions are read-only exact-hash evidence, not accepted identity truth.
`
    );

  assetIdentity
    .command('list')
    .description('List accepted v2 asset identity assertions for the active profile')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 asset-identity list
  $ exitbook links-v2 asset-identity list --json
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentityListCommand(rawOptions, appRuntime, {
        ...LINKS_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'links-v2-asset-identity-list',
      });
    });

  assetIdentity
    .command('suggestions')
    .description('Preview read-only asset identity suggestions from v2 linker evidence')
    .option('--limit <count>', 'Limit the number of suggestions shown')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 asset-identity suggestions
  $ exitbook links-v2 asset-identity suggestions --limit 5
  $ exitbook links-v2 asset-identity suggestions --json

Notes:
  - Always runs v2 linking in dry-run mode.
  - Suggestions are review inputs only; use "accept" to persist an assertion.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentitySuggestionsCommand(rawOptions, appRuntime, {
        ...LINKS_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'links-v2-asset-identity-suggestions',
      });
    });

  assetIdentity
    .command('accept')
    .description('Accept one pairwise asset identity assertion for v2 linking')
    .requiredOption('--asset-id-a <assetId>', 'First asset id in the pair')
    .requiredOption('--asset-id-b <assetId>', 'Second asset id in the pair')
    .option('--relationship-kind <kind>', 'Relationship kind scope', 'internal_transfer')
    .option(
      '--evidence-kind <kind>',
      'Assertion evidence kind: manual, seeded, exact_hash_observed, amount_time_observed',
      'manual'
    )
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 asset-identity accept --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native
  $ exitbook links-v2 asset-identity accept --asset-id-a exchange:coinbase:btc --asset-id-b blockchain:bitcoin:native --json

Notes:
  - The pair is stored canonically; command input order does not matter.
  - Defaults to relationship kind "internal_transfer" and evidence kind "manual".
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentityAcceptCommand(rawOptions, appRuntime, {
        ...LINKS_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'links-v2-asset-identity-accept',
      });
    });

  assetIdentity
    .command('revoke')
    .description('Revoke one accepted v2 asset identity assertion')
    .requiredOption('--asset-id-a <assetId>', 'First asset id in the pair')
    .requiredOption('--asset-id-b <assetId>', 'Second asset id in the pair')
    .option('--relationship-kind <kind>', 'Relationship kind scope', 'internal_transfer')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 asset-identity revoke --asset-id-a exchange:kraken:eth --asset-id-b blockchain:ethereum:native
  $ exitbook links-v2 asset-identity revoke --asset-id-a exchange:coinbase:btc --asset-id-b blockchain:bitcoin:native --json

Notes:
  - The pair is matched canonically; command input order does not matter.
  - Revoking removes the accepted assertion from the replayed assertion projection.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2AssetIdentityRevokeCommand(rawOptions, appRuntime, {
        ...LINKS_V2_ASSET_IDENTITY_CONFIG,
        commandId: 'links-v2-asset-identity-revoke',
      });
    });
}
