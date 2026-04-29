import {
  runLedgerLinking,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionSaveResult,
  type LedgerLinkingAssetIdentitySuggestion,
  type LedgerLinkingDiagnostics,
  type LedgerLinkingRunResult,
} from '@exitbook/accounting/ledger-linking';
import {
  buildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingRunPorts,
} from '@exitbook/data/accounting';
import { err, resultDoAsync } from '@exitbook/foundation';
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

export const LinksV2DiagnoseCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().default(10),
  proposalWindowHours: zod.coerce.number().positive().default(168),
});

export const LinksV2AssetIdentityListCommandOptionsSchema = JsonFlagSchema;

export const LinksV2AssetIdentitySuggestionsCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().optional(),
});

export const LinksV2AssetIdentityAcceptCommandOptionsSchema = JsonFlagSchema.extend({
  assetIdA: zod.string().trim().min(1, 'Asset id A must not be empty'),
  assetIdB: zod.string().trim().min(1, 'Asset id B must not be empty'),
  evidenceKind: zod.enum(['manual', 'seeded', 'exact_hash_observed', 'amount_time_observed']).default('manual'),
  relationshipKind: zod
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration'])
    .default('internal_transfer'),
});

export type LinksV2StatusCommandOptions = z.infer<typeof LinksV2StatusCommandOptionsSchema>;
export type LinksV2RunCommandOptions = z.infer<typeof LinksV2RunCommandOptionsSchema>;
export type LinksV2DiagnoseCommandOptions = z.infer<typeof LinksV2DiagnoseCommandOptionsSchema>;
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

interface LinksV2DiagnoseOutput {
  diagnostics: LedgerLinkingDiagnostics;
  profile: {
    id: number;
    profileKey: string;
  };
  runSummary: {
    acceptedRelationshipCount: number;
    sourceCandidateCount: number;
    targetCandidateCount: number;
    transferCandidateCount: number;
  };
}

interface LinksV2AssetIdentitySuggestionsOutput {
  amountTimeAssetIdentityBlockerCount: number;
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

export async function executeLinksV2DiagnoseCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2RunExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2DiagnoseCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLinksV2DiagnoseCommand(runtime, prepared, config),
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

async function executePreparedLinksV2DiagnoseCommand(
  ctx: CommandRuntime,
  prepared: LinksV2DiagnoseCommandOptions,
  config: LinksV2RunExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database), {
        amountTimeProposalWindowMinutes: prepared.proposalWindowHours * 60,
        dryRun: true,
        includeDiagnostics: true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    if (run.diagnostics === undefined) {
      return yield* toCliResult(
        err(new Error('Links v2 diagnostics were not returned by the ledger-linking runner')),
        ExitCodes.GENERAL_ERROR
      );
    }

    const output: LinksV2DiagnoseOutput = {
      diagnostics: run.diagnostics,
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      runSummary: {
        acceptedRelationshipCount: run.acceptedRelationships.length,
        sourceCandidateCount: run.sourceCandidateCount,
        targetCandidateCount: run.targetCandidateCount,
        transferCandidateCount: run.transferCandidateCount,
      },
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2DiagnoseOutput(output, prepared, config));
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
      amountTimeAssetIdentityBlockerCount: countAssetIdentitySuggestionBlocks(
        run.assetIdentitySuggestions,
        'amount_time_observed'
      ),
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

function renderLinksV2DiagnoseOutput(
  output: LinksV2DiagnoseOutput,
  prepared: LinksV2DiagnoseCommandOptions,
  config: LinksV2RunExecutionConfig
): void {
  const { diagnostics, profile, runSummary } = output;
  const unmatchedSourceCount = diagnostics.unmatchedCandidates.filter(
    (candidate) => candidate.direction === 'source'
  ).length;
  const unmatchedTargetCount = diagnostics.unmatchedCandidates.filter(
    (candidate) => candidate.direction === 'target'
  ).length;
  const proposalGroups = diagnostics.amountTimeProposalGroups.slice(0, prepared.limit);
  const proposals = diagnostics.amountTimeProposals.slice(0, prepared.limit);
  const unmatchedGroups = diagnostics.unmatchedCandidateGroups.slice(0, prepared.limit);
  const classificationGroups = diagnostics.candidateClassificationGroups.slice(0, prepared.limit);

  console.log(config.title);
  console.log('Mode: dry run');
  console.log(`Profile: ${profile.profileKey} (#${profile.id})`);
  console.log(
    `Transfer candidates: ${runSummary.transferCandidateCount} (${runSummary.sourceCandidateCount} source, ${runSummary.targetCandidateCount} target)`
  );
  console.log(`Accepted relationships: ${runSummary.acceptedRelationshipCount}`);
  console.log(`Unmatched candidate remainders: ${unmatchedSourceCount} source, ${unmatchedTargetCount} target`);
  console.log(`Amount/time window: ${formatWindowHours(diagnostics.amountTimeWindowMinutes)}`);
  console.log(
    `Amount/time proposals: ${diagnostics.amountTimeProposalCount} (${diagnostics.amountTimeUniqueProposalCount} unique)`
  );
  console.log(`Asset identity blockers: ${diagnostics.assetIdentityBlockerProposalCount}`);
  console.log(
    `Classification groups: ${classificationGroups.length} of ${diagnostics.candidateClassificationGroups.length}`
  );
  for (const group of classificationGroups) {
    console.log(
      `  ${group.classification}: ${group.candidateCount} candidate(s), ${group.sourceCandidateCount} source, ${group.targetCandidateCount} target`
    );
  }

  console.log(`Unmatched groups: ${unmatchedGroups.length} of ${diagnostics.unmatchedCandidateGroups.length}`);
  for (const group of unmatchedGroups) {
    console.log(
      `  ${group.direction} ${group.assetSymbol} ${group.platformKey}: ${group.candidateCount} candidate(s), ${group.remainingAmountTotal} ${group.assetSymbol} remaining`
    );
  }

  console.log(`Amount/time groups: ${proposalGroups.length} of ${diagnostics.amountTimeProposalGroups.length}`);
  for (const group of proposalGroups) {
    console.log(
      `  ${group.assetSymbol} ${group.amount} ${group.sourcePlatformKey} -> ${group.targetPlatformKey}: ${group.proposalCount} proposal(s), ${group.uniqueProposalCount} unique, time ${formatDurationRange(group.minTimeDistanceSeconds, group.maxTimeDistanceSeconds)}`
    );
  }

  console.log(`Amount/time proposal examples: ${proposals.length} of ${diagnostics.amountTimeProposals.length}`);
  for (const proposal of proposals) {
    console.log(
      `  ${proposal.uniqueness} ${proposal.assetSymbol} ${proposal.amount} ${proposal.source.platformKey} #${proposal.source.candidateId} -> ${proposal.target.platformKey} #${proposal.target.candidateId} (${formatDurationSeconds(proposal.timeDistanceSeconds)}, ${proposal.timeDirection})`
    );
    console.log(
      `    source ${formatDate(proposal.source.activityDatetime)} ${shortenValue(proposal.source.postingFingerprint)}`
    );
    console.log(
      `    target ${formatDate(proposal.target.activityDatetime)} ${shortenValue(proposal.target.postingFingerprint)}`
    );
  }
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
      `  ${stats.name}: ${stats.relationshipCount} relationship(s), ${stats.claimedCandidateCount} claimed candidate(s), ${stats.consumedCandidateCount} fully consumed candidate(s)`
    );
  }
  console.log(`Accepted relationships: ${run.acceptedRelationships.length}`);
  console.log(`Exact-hash matches: ${run.exactHashMatches.length}`);
  console.log(`Exact-hash ambiguities: ${run.exactHashAmbiguities.length}`);
  console.log(`Exact-hash asset identity blocks: ${run.exactHashAssetIdentityBlocks.length}`);
  console.log(`Same-hash grouped matches: ${run.sameHashGroupedMatches.length}`);
  console.log(`Same-hash unresolved groups: ${run.sameHashGroupedUnresolvedGroups.length}`);
  console.log(`Counterparty roundtrip matches: ${run.counterpartyRoundtripMatches.length}`);
  console.log(`Counterparty roundtrip ambiguities: ${run.counterpartyRoundtripAmbiguities.length}`);
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
  console.log(`Suggestions: ${output.suggestions.length} of ${output.totalSuggestionCount}`);
  console.log(
    `Evidence: ${output.exactHashAssetIdentityBlockCount} exact-hash blocker(s), ${output.amountTimeAssetIdentityBlockerCount} amount/time blocker(s)`
  );

  for (const suggestion of output.suggestions) {
    console.log(
      `  ${suggestion.relationshipKind} ${suggestion.assetSymbol}: ${suggestion.assetIdA} <-> ${suggestion.assetIdB} (${suggestion.blockCount} ${formatAssetIdentityEvidenceKind(suggestion.evidenceKind)} blocker(s))`
    );
    for (const example of suggestion.examples) {
      console.log(`    ${formatAssetIdentitySuggestionExample(suggestion, example)}`);
    }
    console.log(
      `    accept: exitbook ${config.commandPath} asset-identity accept --asset-id-a ${suggestion.assetIdA} --asset-id-b ${suggestion.assetIdB} --relationship-kind ${suggestion.relationshipKind} --evidence-kind ${suggestion.evidenceKind}`
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

function countAssetIdentitySuggestionBlocks(
  suggestions: readonly LedgerLinkingAssetIdentitySuggestion[],
  evidenceKind: LedgerLinkingAssetIdentitySuggestion['evidenceKind']
): number {
  return suggestions
    .filter((suggestion) => suggestion.evidenceKind === evidenceKind)
    .reduce((sum, suggestion) => sum + suggestion.blockCount, 0);
}

function formatWindowHours(windowMinutes: number): string {
  const hours = windowMinutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${windowMinutes}m`;
}

function formatDurationRange(minSeconds: number, maxSeconds: number): string {
  const min = formatDurationSeconds(minSeconds);
  const max = formatDurationSeconds(maxSeconds);
  return min === max ? min : `${min}-${max}`;
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return Number.isInteger(minutes) ? `${minutes}m` : `${minutes.toFixed(1)}m`;
  }

  const hours = minutes / 60;
  if (hours < 48) {
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }

  const days = hours / 24;
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`;
}

function formatDate(date: Date): string {
  return date.toISOString();
}

function formatAssetIdentitySuggestionExample(
  suggestion: LedgerLinkingAssetIdentitySuggestion,
  example: LedgerLinkingAssetIdentitySuggestion['examples'][number]
): string {
  const details: string[] = [`example: ${example.amount} ${suggestion.assetSymbol}`];

  if (example.timeDistanceSeconds !== undefined) {
    details.push(`time ${formatDurationSeconds(example.timeDistanceSeconds)}`);
  }

  if (example.sourceCandidateId !== undefined && example.targetCandidateId !== undefined) {
    details.push(`candidates #${example.sourceCandidateId} -> #${example.targetCandidateId}`);
  }

  const hash = formatAssetIdentitySuggestionHash(example);
  if (hash !== undefined) {
    details.push(`hash ${hash}`);
  }

  return details.join(', ');
}

function formatAssetIdentityEvidenceKind(evidenceKind: LedgerLinkingAssetIdentitySuggestion['evidenceKind']): string {
  switch (evidenceKind) {
    case 'exact_hash_observed':
      return 'exact-hash';
    case 'amount_time_observed':
      return 'amount/time';
  }
}

function formatAssetIdentitySuggestionHash(
  example: LedgerLinkingAssetIdentitySuggestion['examples'][number]
): string | undefined {
  if (example.sourceBlockchainTransactionHash === undefined || example.targetBlockchainTransactionHash === undefined) {
    return undefined;
  }

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
