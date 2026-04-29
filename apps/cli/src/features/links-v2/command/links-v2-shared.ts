import {
  runLedgerLinking,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionSaveResult,
  type LedgerLinkingAssetIdentitySuggestion,
  type LedgerLinkingRunResult,
} from '@exitbook/accounting/ledger-linking';
import {
  buildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingRunPorts,
} from '@exitbook/data/accounting';
import { resultDoAsync } from '@exitbook/foundation';
import type { z } from 'zod';
import { z as zod } from 'zod';

import {
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

export const LinksV2StatusCommandOptionsSchema = JsonFlagSchema;

export const LinksV2RunCommandOptionsSchema = JsonFlagSchema.extend({
  dryRun: zod.boolean().optional(),
});

export const LinksV2AssetIdentityListCommandOptionsSchema = JsonFlagSchema;

export const LinksV2AssetIdentitySuggestionsCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().optional(),
});

export const LinksV2AssetIdentityAcceptCommandOptionsSchema = JsonFlagSchema.extend({
  assetIdA: zod.string().trim().min(1, 'Asset id A must not be empty'),
  assetIdB: zod.string().trim().min(1, 'Asset id B must not be empty'),
  evidenceKind: zod.enum(['manual', 'seeded', 'exact_hash_observed']).default('manual'),
  relationshipKind: zod
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration'])
    .default('internal_transfer'),
});

export type LinksV2StatusCommandOptions = z.infer<typeof LinksV2StatusCommandOptionsSchema>;
export type LinksV2RunCommandOptions = z.infer<typeof LinksV2RunCommandOptionsSchema>;
export type LinksV2AssetIdentityAcceptCommandOptions = z.infer<typeof LinksV2AssetIdentityAcceptCommandOptionsSchema>;
export type LinksV2AssetIdentityListCommandOptions = z.infer<typeof LinksV2AssetIdentityListCommandOptionsSchema>;
export type LinksV2AssetIdentitySuggestionsCommandOptions = z.infer<
  typeof LinksV2AssetIdentitySuggestionsCommandOptionsSchema
>;

interface LinksV2RunOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  run: LedgerLinkingRunResult;
}

interface LinksV2AssetIdentityListOutput {
  assertions: readonly LedgerLinkingAssetIdentityAssertion[];
  profile: {
    id: number;
    profileKey: string;
  };
}

interface LinksV2AssetIdentitySuggestionsOutput {
  exactHashAssetIdentityBlockCount: number;
  profile: {
    id: number;
    profileKey: string;
  };
  suggestions: readonly LedgerLinkingAssetIdentitySuggestion[];
  totalSuggestionCount: number;
}

interface LinksV2AssetIdentityAcceptOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LedgerLinkingAssetIdentityAssertionSaveResult;
}

export interface LinksV2RunExecutionConfig {
  commandId: string;
  forceDryRun?: boolean | undefined;
  title: string;
  migrationNote?: string | undefined;
}

export interface LinksV2AssetIdentityExecutionConfig {
  commandPath: string;
  commandId: string;
  label: string;
}

export async function executeLinksV2RunCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2RunExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);
  const optionsSchema =
    config.forceDryRun === true ? LinksV2StatusCommandOptionsSchema : LinksV2RunCommandOptionsSchema;

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, optionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2RunCommand(runtime, prepared, {
        ...config,
        dryRun: resolveLinksV2DryRunMode(prepared, config),
      }),
  });
}

export async function executeLinksV2AssetIdentityListCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2AssetIdentityListCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLinksV2AssetIdentityListCommand(runtime, prepared, config),
  });
}

export async function executeLinksV2AssetIdentitySuggestionsCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2AssetIdentitySuggestionsCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2AssetIdentitySuggestionsCommand(runtime, prepared, config),
  });
}

export async function executeLinksV2AssetIdentityAcceptCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2AssetIdentityAcceptCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2AssetIdentityAcceptCommand(runtime, prepared, config),
  });
}

function resolveLinksV2DryRunMode(
  prepared: LinksV2StatusCommandOptions | LinksV2RunCommandOptions,
  config: LinksV2RunExecutionConfig
): boolean {
  if (config.forceDryRun === true) {
    return true;
  }

  return 'dryRun' in prepared && prepared.dryRun === true;
}

async function executePreparedLinksV2RunCommand(
  ctx: CommandRuntime,
  prepared: LinksV2StatusCommandOptions | LinksV2RunCommandOptions,
  config: LinksV2RunExecutionConfig & { dryRun: boolean }
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database), {
        dryRun: config.dryRun,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2RunOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      run,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2RunOutput(output, config));
  });
}

async function executePreparedLinksV2AssetIdentityListCommand(
  ctx: CommandRuntime,
  prepared: LinksV2AssetIdentityListCommandOptions,
  config: LinksV2AssetIdentityExecutionConfig
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
    const output: LinksV2AssetIdentityListOutput = {
      assertions,
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2AssetIdentityListOutput(output, config));
  });
}

async function executePreparedLinksV2AssetIdentitySuggestionsCommand(
  ctx: CommandRuntime,
  prepared: LinksV2AssetIdentitySuggestionsCommandOptions,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database), {
        dryRun: true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const suggestions = limitAssetIdentitySuggestions(run.assetIdentitySuggestions, prepared.limit);
    const output: LinksV2AssetIdentitySuggestionsOutput = {
      exactHashAssetIdentityBlockCount: run.exactHashAssetIdentityBlocks.length,
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      suggestions,
      totalSuggestionCount: run.assetIdentitySuggestions.length,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2AssetIdentitySuggestionsOutput(output, config));
  });
}

async function executePreparedLinksV2AssetIdentityAcceptCommand(
  ctx: CommandRuntime,
  prepared: LinksV2AssetIdentityAcceptCommandOptions,
  config: LinksV2AssetIdentityExecutionConfig
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
    const output: LinksV2AssetIdentityAcceptOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2AssetIdentityAcceptOutput(output, config));
  });
}

function renderLinksV2RunOutput(
  output: LinksV2RunOutput,
  config: LinksV2RunExecutionConfig & { dryRun: boolean }
): void {
  const { profile, run } = output;

  console.log(config.title);
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
  console.log(`Same-hash grouped matches: ${run.sameHashGroupedMatches.length}`);
  console.log(`Same-hash unresolved groups: ${run.sameHashGroupedUnresolvedGroups.length}`);
  console.log(`Asset identity suggestions: ${run.assetIdentitySuggestions.length}`);
  console.log(`Skipped postings: ${run.skippedCandidates.length}`);

  if (config.migrationNote !== undefined) {
    console.log(config.migrationNote);
  }

  if (run.persistence.mode === 'dry_run') {
    console.log(`Planned materialization: ${run.persistence.plannedRelationshipCount} relationship(s)`);
    return;
  }

  const materialization = run.persistence.materialization;
  console.log(
    `Materialized: ${materialization.savedCount} saved, ${materialization.previousCount} replaced, ${materialization.resolvedAllocationCount} allocation refs resolved`
  );
}

function renderLinksV2AssetIdentityListOutput(
  output: LinksV2AssetIdentityListOutput,
  config: LinksV2AssetIdentityExecutionConfig
): void {
  console.log(`${config.label} asset identity assertions for ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Assertions: ${output.assertions.length}`);

  for (const assertion of output.assertions) {
    console.log(
      `  ${assertion.relationshipKind}: ${assertion.assetIdA} <-> ${assertion.assetIdB} (${assertion.evidenceKind})`
    );
  }
}

function renderLinksV2AssetIdentitySuggestionsOutput(
  output: LinksV2AssetIdentitySuggestionsOutput,
  config: LinksV2AssetIdentityExecutionConfig
): void {
  console.log(`${config.label} asset identity suggestions for ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(
    `Suggestions: ${output.suggestions.length} of ${output.totalSuggestionCount} from ${output.exactHashAssetIdentityBlockCount} exact-hash blocker(s)`
  );

  for (const suggestion of output.suggestions) {
    console.log(
      `  ${suggestion.relationshipKind} ${suggestion.assetSymbol}: ${suggestion.assetIdA} <-> ${suggestion.assetIdB} (${suggestion.blockCount} blocker(s))`
    );
    for (const example of suggestion.examples) {
      console.log(
        `    example: ${example.amount} ${suggestion.assetSymbol}, hash ${formatAssetIdentitySuggestionHash(example)}`
      );
    }
    console.log(
      `    accept: exitbook ${config.commandPath} asset-identity accept --asset-id-a ${suggestion.assetIdA} --asset-id-b ${suggestion.assetIdB} --relationship-kind ${suggestion.relationshipKind} --evidence-kind exact_hash_observed`
    );
  }
}

function renderLinksV2AssetIdentityAcceptOutput(
  output: LinksV2AssetIdentityAcceptOutput,
  config: LinksV2AssetIdentityExecutionConfig
): void {
  const { assertion, action } = output.result;

  console.log(`${config.label} asset identity assertion ${action}.`);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Relationship kind: ${assertion.relationshipKind}`);
  console.log(`Assets: ${assertion.assetIdA} <-> ${assertion.assetIdB}`);
  console.log(`Evidence: ${assertion.evidenceKind}`);
}

function limitAssetIdentitySuggestions(
  suggestions: readonly LedgerLinkingAssetIdentitySuggestion[],
  limit: number | undefined
): readonly LedgerLinkingAssetIdentitySuggestion[] {
  return limit === undefined ? suggestions : suggestions.slice(0, limit);
}

function formatAssetIdentitySuggestionHash(example: LedgerLinkingAssetIdentitySuggestion['examples'][number]): string {
  if (example.sourceBlockchainTransactionHash === example.targetBlockchainTransactionHash) {
    return shortenValue(example.sourceBlockchainTransactionHash);
  }

  return `${shortenValue(example.sourceBlockchainTransactionHash)} -> ${shortenValue(example.targetBlockchainTransactionHash)}`;
}

function shortenValue(value: string): string {
  const maxLength = 28;
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-10)}`;
}
