import {
  runLedgerLinking,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionSaveResult,
  type LedgerLinkingRunResult,
} from '@exitbook/accounting/ledger-linking';
import {
  buildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingRunPorts,
} from '@exitbook/data/accounting';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import {
  LedgerLinkingV2AssetIdentityAcceptCommandOptionsSchema,
  LedgerLinkingV2AssetIdentityListCommandOptionsSchema,
  LedgerLinkingV2RunCommandOptionsSchema,
} from './ledger-option-schemas.js';

type LedgerLinkingV2RunCommandOptions = z.infer<typeof LedgerLinkingV2RunCommandOptionsSchema>;
type LedgerLinkingV2AssetIdentityAcceptCommandOptions = z.infer<
  typeof LedgerLinkingV2AssetIdentityAcceptCommandOptionsSchema
>;
type LedgerLinkingV2AssetIdentityListCommandOptions = z.infer<
  typeof LedgerLinkingV2AssetIdentityListCommandOptionsSchema
>;

interface LedgerLinkingV2RunOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  run: LedgerLinkingRunResult;
}

interface LedgerLinkingV2AssetIdentityListOutput {
  assertions: readonly LedgerLinkingAssetIdentityAssertion[];
  profile: {
    id: number;
    profileKey: string;
  };
}

interface LedgerLinkingV2AssetIdentityAcceptOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LedgerLinkingAssetIdentityAssertionSaveResult;
}

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
      await executeLedgerLinkingV2RunCommand(rawOptions, appRuntime);
    });

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
      await executeLedgerLinkingV2AssetIdentityListCommand(rawOptions, appRuntime);
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
      await executeLedgerLinkingV2AssetIdentityAcceptCommand(rawOptions, appRuntime);
    });
}

async function executeLedgerLinkingV2RunCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'ledger-linking-v2-run',
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LedgerLinkingV2RunCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLedgerLinkingV2RunCommand(runtime, prepared),
  });
}

async function executePreparedLedgerLinkingV2RunCommand(
  ctx: CommandRuntime,
  prepared: LedgerLinkingV2RunCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database), {
        dryRun: prepared.dryRun === true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const output: LedgerLinkingV2RunOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      run,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLedgerLinkingV2RunOutput(output));
  });
}

async function executeLedgerLinkingV2AssetIdentityListCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'ledger-linking-v2-asset-identity-list',
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LedgerLinkingV2AssetIdentityListCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLedgerLinkingV2AssetIdentityListCommand(runtime, prepared),
  });
}

async function executePreparedLedgerLinkingV2AssetIdentityListCommand(
  ctx: CommandRuntime,
  prepared: LedgerLinkingV2AssetIdentityListCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const assertions = yield* toCliResult(
      await buildLedgerLinkingAssetIdentityAssertionReader(database).loadLedgerLinkingAssetIdentityAssertions(
        profile.id
      ),
      ExitCodes.GENERAL_ERROR
    );
    const output: LedgerLinkingV2AssetIdentityListOutput = {
      assertions,
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLedgerLinkingV2AssetIdentityListOutput(output));
  });
}

async function executeLedgerLinkingV2AssetIdentityAcceptCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'ledger-linking-v2-asset-identity-accept',
    format,
    appRuntime,
    prepare: async () =>
      parseCliCommandOptionsResult(rawOptions, LedgerLinkingV2AssetIdentityAcceptCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLedgerLinkingV2AssetIdentityAcceptCommand(runtime, prepared),
  });
}

async function executePreparedLedgerLinkingV2AssetIdentityAcceptCommand(
  ctx: CommandRuntime,
  prepared: LedgerLinkingV2AssetIdentityAcceptCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const result = yield* toCliResult(
      await buildLedgerLinkingAssetIdentityAssertionStore(database).saveLedgerLinkingAssetIdentityAssertion(
        profile.id,
        {
          assetIdA: prepared.assetIdA,
          assetIdB: prepared.assetIdB,
          evidenceKind: prepared.evidenceKind,
          relationshipKind: prepared.relationshipKind,
        }
      ),
      ExitCodes.GENERAL_ERROR
    );
    const output: LedgerLinkingV2AssetIdentityAcceptOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLedgerLinkingV2AssetIdentityAcceptOutput(output));
  });
}

function renderLedgerLinkingV2RunOutput(output: LedgerLinkingV2RunOutput): void {
  const { profile, run } = output;

  console.log('Ledger linking v2 completed.');
  console.log(`Mode: ${run.persistence.mode === 'dry_run' ? 'dry run' : 'persisted'}`);
  console.log(`Profile: ${profile.profileKey} (#${profile.id})`);
  console.log(`Posting inputs: ${run.postingInputCount}`);
  console.log(
    `Transfer candidates: ${run.transferCandidateCount} (${run.sourceCandidateCount} source, ${run.targetCandidateCount} target)`
  );
  console.log(
    `Matched candidates: ${run.matchedSourceCandidateCount} source, ${run.matchedTargetCandidateCount} target`
  );
  console.log(
    `Unmatched candidates: ${run.unmatchedSourceCandidateCount} source, ${run.unmatchedTargetCandidateCount} target`
  );
  console.log(`Deterministic recognizers: ${run.deterministicRecognizerStats.length}`);
  for (const stats of run.deterministicRecognizerStats) {
    console.log(
      `  ${stats.name}: ${stats.relationshipCount} relationship(s), ${stats.consumedCandidateCount} candidate(s)`
    );
  }
  console.log(`Accepted relationships: ${run.acceptedRelationships.length}`);
  console.log(`Exact-hash matches: ${run.exactHashMatches.length}`);
  console.log(`Exact-hash ambiguities: ${run.exactHashAmbiguities.length}`);
  console.log(`Exact-hash asset identity blocks: ${run.exactHashAssetIdentityBlocks.length}`);
  console.log(`Skipped postings: ${run.skippedCandidates.length}`);

  if (run.persistence.mode === 'dry_run') {
    console.log(`Planned materialization: ${run.persistence.plannedRelationshipCount} relationship(s)`);
    return;
  }

  const materialization = run.persistence.materialization;
  console.log(
    `Materialized: ${materialization.savedCount} saved, ${materialization.previousCount} replaced, ${materialization.resolvedEndpointCount} endpoint refs resolved`
  );
}

function renderLedgerLinkingV2AssetIdentityListOutput(output: LedgerLinkingV2AssetIdentityListOutput): void {
  console.log(`Ledger linking asset identity assertions for ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Assertions: ${output.assertions.length}`);

  for (const assertion of output.assertions) {
    console.log(
      `  ${assertion.relationshipKind}: ${assertion.assetIdA} <-> ${assertion.assetIdB} (${assertion.evidenceKind})`
    );
  }
}

function renderLedgerLinkingV2AssetIdentityAcceptOutput(output: LedgerLinkingV2AssetIdentityAcceptOutput): void {
  const { assertion, action } = output.result;

  console.log(`Ledger linking asset identity assertion ${action}.`);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Relationship kind: ${assertion.relationshipKind}`);
  console.log(`Assets: ${assertion.assetIdA} <-> ${assertion.assetIdB}`);
  console.log(`Evidence: ${assertion.evidenceKind}`);
}
