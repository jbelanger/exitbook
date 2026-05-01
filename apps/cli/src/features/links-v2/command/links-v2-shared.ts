import {
  buildLedgerLinkingReviewQueue,
  buildLedgerLinkingGapResolutionKey,
  buildLedgerTransferLinkingCandidates,
  canonicalizeLedgerLinkingAssetIdentityPair,
  buildReviewedLedgerLinkingRelationshipStableKey,
  LedgerLinkingReviewedRelationshipOverrideSchema,
  ledgerTransactionHashesMatch,
  runLedgerLinking,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionReplacementResult,
  type LedgerLinkingAssetIdentitySuggestion,
  type LedgerLinkingDiagnostics,
  type LedgerLinkingReviewedRelationshipOverride,
  type LedgerLinkingReviewItem,
  type LedgerLinkingReviewQueue,
  type LedgerLinkingRunResult,
  type LedgerTransferLinkingCandidate,
} from '@exitbook/accounting/ledger-linking';
import type {
  LedgerLinkingGapResolutionAcceptPayload,
  LedgerLinkingRelationshipAcceptPayload,
  OverrideEvent,
} from '@exitbook/core';
import {
  buildLedgerLinkingAssetIdentityAssertionReader,
  buildLedgerLinkingAssetIdentityAssertionStore,
  buildLedgerLinkingCandidateSourceReader,
  buildLedgerLinkingRunPorts,
} from '@exitbook/data/accounting';
import {
  materializeStoredLedgerLinkingAssetIdentityAssertions,
  OverrideStore,
  readLedgerLinkingAssetIdentityAssertionOverrides,
  readLedgerLinkingRelationshipOverrides,
  readResolvedLedgerLinkingGapResolutionKeys,
  readResolvedLedgerLinkingGapResolutions,
} from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import { z as zod } from 'zod';

import {
  cliErr,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { buildLinksV2ManualRelationshipAcceptPayload } from './links-v2-manual-relationships.js';

export const LinksV2StatusCommandOptionsSchema = JsonFlagSchema;

export const LinksV2RunCommandOptionsSchema = JsonFlagSchema.extend({
  dryRun: zod.boolean().optional(),
});

export const LinksV2DiagnoseCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().default(10),
  proposalWindowHours: zod.coerce.number().positive().default(168),
});

export const LinksV2ReviewCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().default(20),
});

export const LinksV2ReviewViewCommandOptionsSchema = JsonFlagSchema;
export const LinksV2ReviewAcceptCommandOptionsSchema = JsonFlagSchema;
export const LinksV2ReviewCreateRelationshipCommandOptionsSchema = JsonFlagSchema.extend({
  reason: zod.string().trim().min(1, 'Manual relationship reason must not be empty'),
  relationshipKind: zod
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover', 'bridge', 'asset_migration'])
    .default('internal_transfer'),
  sourcePosting: zod.string().trim().min(1, 'Source posting fingerprint must not be empty'),
  sourceQuantity: zod.string().trim().min(1, 'Source quantity must not be empty').optional(),
  targetPosting: zod.string().trim().min(1, 'Target posting fingerprint must not be empty'),
  targetQuantity: zod.string().trim().min(1, 'Target quantity must not be empty').optional(),
});
export const LinksV2ReviewRevokeTargetKindSchema = zod.enum(['relationship', 'gap-resolution']);
export const LinksV2ReviewRevokeCommandOptionsSchema = JsonFlagSchema;

export const LinksV2AssetIdentityListCommandOptionsSchema = JsonFlagSchema;

export const LinksV2AssetIdentitySuggestionsCommandOptionsSchema = JsonFlagSchema.extend({
  limit: zod.coerce.number().int().positive().optional(),
});

export const LinksV2AssetIdentityAcceptCommandOptionsSchema = JsonFlagSchema.extend({
  assetIdA: zod.string().trim().min(1, 'Asset id A must not be empty'),
  assetIdB: zod.string().trim().min(1, 'Asset id B must not be empty'),
  evidenceKind: zod.enum(['manual', 'seeded', 'exact_hash_observed', 'amount_time_observed']).default('manual'),
  relationshipKind: zod
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover'])
    .default('internal_transfer'),
});
export const LinksV2AssetIdentityRevokeCommandOptionsSchema = JsonFlagSchema.extend({
  assetIdA: zod.string().trim().min(1, 'Asset id A must not be empty'),
  assetIdB: zod.string().trim().min(1, 'Asset id B must not be empty'),
  relationshipKind: zod
    .enum(['internal_transfer', 'external_transfer', 'same_hash_carryover'])
    .default('internal_transfer'),
});

export type LinksV2StatusCommandOptions = z.infer<typeof LinksV2StatusCommandOptionsSchema>;
export type LinksV2RunCommandOptions = z.infer<typeof LinksV2RunCommandOptionsSchema>;
export type LinksV2DiagnoseCommandOptions = z.infer<typeof LinksV2DiagnoseCommandOptionsSchema>;
export type LinksV2ReviewCommandOptions = z.infer<typeof LinksV2ReviewCommandOptionsSchema>;
export type LinksV2ReviewViewCommandOptions = z.infer<typeof LinksV2ReviewViewCommandOptionsSchema>;
export type LinksV2ReviewAcceptCommandOptions = z.infer<typeof LinksV2ReviewAcceptCommandOptionsSchema>;
export type LinksV2ReviewCreateRelationshipCommandOptions = z.infer<
  typeof LinksV2ReviewCreateRelationshipCommandOptionsSchema
>;
export type LinksV2ReviewRevokeCommandOptions = z.infer<typeof LinksV2ReviewRevokeCommandOptionsSchema>;
export type LinksV2ReviewRevokeTargetKind = z.infer<typeof LinksV2ReviewRevokeTargetKindSchema>;
export type LinksV2AssetIdentityAcceptCommandOptions = z.infer<typeof LinksV2AssetIdentityAcceptCommandOptionsSchema>;
export type LinksV2AssetIdentityRevokeCommandOptions = z.infer<typeof LinksV2AssetIdentityRevokeCommandOptionsSchema>;
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
  feeAdjustedExactHashAssetIdentityBlockCount: number;
  profile: {
    id: number;
    profileKey: string;
  };
  suggestions: readonly LedgerLinkingAssetIdentitySuggestion[];
  totalSuggestionCount: number;
}

interface LinksV2ReviewOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  reviewQueue: Omit<LedgerLinkingReviewQueue, 'items'> & {
    items: readonly LedgerLinkingReviewItem[];
    shownItemCount: number;
  };
}

interface LinksV2ReviewViewOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  reviewItem: LedgerLinkingReviewItem;
}

interface LinksV2ReviewAcceptOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LinksV2ReviewAcceptResult;
  reviewId: string;
  reviewItem: LedgerLinkingReviewItem;
}

interface LinksV2ReviewCreateRelationshipOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LinksV2RelationshipAcceptResult;
}

interface LinksV2ReviewRevokeOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LinksV2ReviewRevokeResult;
  targetId: string;
  targetKind: LinksV2ReviewRevokeTargetKind;
}

interface LinksV2AssetIdentityAcceptOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LinksV2AssetIdentityAcceptResult;
}

interface LinksV2AssetIdentityRevokeOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  result: LinksV2AssetIdentityRevokeResult;
}

interface LinksV2AssetIdentityAcceptResult {
  assertion: LedgerLinkingAssetIdentityAssertion;
  materialization: LedgerLinkingAssetIdentityAssertionReplacementResult;
  overrideEvent: OverrideEvent;
}

interface LinksV2AssetIdentityRevokeResult {
  assertion: LedgerLinkingAssetIdentityAssertion;
  materialization: LedgerLinkingAssetIdentityAssertionReplacementResult;
  overrideEvent: OverrideEvent;
}

type LinksV2ReviewAcceptResult =
  | {
      kind: 'asset_identity';
      result: LinksV2AssetIdentityAcceptResult;
    }
  | {
      kind: 'link_proposal';
      result: LinksV2RelationshipAcceptResult;
    }
  | {
      kind: 'gap_resolution';
      result: LinksV2GapResolutionAcceptResult;
    };

type LinksV2ReviewRevokeResult =
  | {
      kind: 'relationship';
      result: LinksV2RelationshipRevokeResult;
    }
  | {
      kind: 'gap_resolution';
      result: LinksV2GapResolutionRevokeResult;
    };

interface LinksV2RelationshipAcceptResult {
  overrideEvent: OverrideEvent;
  relationshipKind: string;
  relationshipStableKey: string;
  run: LedgerLinkingRunResult;
  sourcePostingFingerprint: string;
  targetPostingFingerprint: string;
}

interface LinksV2RelationshipRevokeResult {
  overrideEvent: OverrideEvent;
  relationshipStableKey: string;
  run: LedgerLinkingRunResult;
}

interface LinksV2GapResolutionAcceptResult {
  overrideEvent: OverrideEvent;
  resolutionKey: string;
}

interface LinksV2GapResolutionRevokeResult {
  overrideEvent: OverrideEvent;
  resolutionKey: string;
}

interface LinksV2CommandProfile {
  id: number;
  profileKey: string;
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

export interface LinksV2ReviewExecutionConfig {
  commandId: string;
  title: string;
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

export async function executeLinksV2ReviewCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2ReviewExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2ReviewCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLinksV2ReviewCommand(runtime, prepared, config),
  });
}

export async function executeLinksV2ReviewViewCommand(
  reviewId: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2ReviewExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2ReviewViewCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2ReviewViewCommand(runtime, reviewId, prepared, config),
  });
}

export async function executeLinksV2ReviewAcceptCommand(
  reviewId: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2ReviewExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2ReviewAcceptCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2ReviewAcceptCommand(runtime, reviewId, prepared, config),
  });
}

export async function executeLinksV2ReviewCreateRelationshipCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2ReviewExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2ReviewCreateRelationshipCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2ReviewCreateRelationshipCommand(runtime, prepared, config),
  });
}

export async function executeLinksV2ReviewRevokeCommand(
  targetKind: string,
  targetId: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2ReviewExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2ReviewRevokeCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2ReviewRevokeCommand(runtime, targetKind, targetId, prepared, config),
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

export async function executeLinksV2AssetIdentityRevokeCommand(
  rawOptions: unknown,
  appRuntime: CliAppRuntime,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: config.commandId,
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2AssetIdentityRevokeCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2AssetIdentityRevokeCommand(runtime, prepared, config),
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

function buildLinksV2RunPorts(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>
) {
  return buildLedgerLinkingRunPorts(database, {
    overrideStore: new OverrideStore(ctx.dataDir),
  });
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
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
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
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
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
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
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
      feeAdjustedExactHashAssetIdentityBlockCount: run.feeAdjustedExactHashAssetIdentityBlocks.length,
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

async function executePreparedLinksV2ReviewCommand(
  ctx: CommandRuntime,
  prepared: LinksV2ReviewCommandOptions,
  config: LinksV2ReviewExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
        dryRun: true,
        includeDiagnostics: true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const resolvedGapResolutionKeys = yield* toCliResult(
      await readLinksV2ResolvedGapResolutionKeys(ctx, profile),
      ExitCodes.GENERAL_ERROR
    );
    const reviewQueue = yield* toCliResult(
      buildLinksV2ReviewQueueFromRun(run, resolvedGapResolutionKeys),
      ExitCodes.GENERAL_ERROR
    );
    const shownItems = reviewQueue.items.slice(0, prepared.limit);
    const output: LinksV2ReviewOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      reviewQueue: {
        assetIdentitySuggestionCount: reviewQueue.assetIdentitySuggestionCount,
        gapResolutionCount: reviewQueue.gapResolutionCount,
        itemCount: reviewQueue.itemCount,
        items: shownItems,
        linkProposalCount: reviewQueue.linkProposalCount,
        shownItemCount: shownItems.length,
      },
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2ReviewOutput(output, config));
  });
}

async function executePreparedLinksV2ReviewViewCommand(
  ctx: CommandRuntime,
  reviewId: string,
  prepared: LinksV2ReviewViewCommandOptions,
  config: LinksV2ReviewExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
        dryRun: true,
        includeDiagnostics: true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const resolvedGapResolutionKeys = yield* toCliResult(
      await readLinksV2ResolvedGapResolutionKeys(ctx, profile),
      ExitCodes.GENERAL_ERROR
    );
    const reviewQueue = yield* toCliResult(
      buildLinksV2ReviewQueueFromRun(run, resolvedGapResolutionKeys),
      ExitCodes.GENERAL_ERROR
    );
    const reviewItem = yield* resolveLinksV2ReviewItem(reviewId, reviewQueue.items);
    const output: LinksV2ReviewViewOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      reviewItem,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2ReviewViewOutput(output, config));
  });
}

async function executePreparedLinksV2ReviewAcceptCommand(
  ctx: CommandRuntime,
  reviewId: string,
  prepared: LinksV2ReviewAcceptCommandOptions,
  config: LinksV2ReviewExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLinksV2RunPorts(ctx, database), {
        dryRun: true,
        includeDiagnostics: true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const resolvedGapResolutionKeys = yield* toCliResult(
      await readLinksV2ResolvedGapResolutionKeys(ctx, profile),
      ExitCodes.GENERAL_ERROR
    );
    const reviewQueue = yield* toCliResult(
      buildLinksV2ReviewQueueFromRun(run, resolvedGapResolutionKeys),
      ExitCodes.GENERAL_ERROR
    );
    const reviewItem = yield* resolveLinksV2ReviewItem(reviewId, reviewQueue.items);

    const result = yield* toCliResult(
      await acceptLinksV2ReviewItem(ctx, database, profile, reviewItem),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2ReviewAcceptOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
      reviewId: reviewItem.reviewId,
      reviewItem,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2ReviewAcceptOutput(output, config));
  });
}

async function executePreparedLinksV2ReviewCreateRelationshipCommand(
  ctx: CommandRuntime,
  prepared: LinksV2ReviewCreateRelationshipCommandOptions,
  config: LinksV2ReviewExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const result = yield* toCliResult(
      await createLinksV2ManualRelationshipOverride(ctx, database, profile, prepared),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2ReviewCreateRelationshipOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2ReviewCreateRelationshipOutput(output, config));
  });
}

async function executePreparedLinksV2ReviewRevokeCommand(
  ctx: CommandRuntime,
  rawTargetKind: string,
  targetId: string,
  prepared: LinksV2ReviewRevokeCommandOptions,
  config: LinksV2ReviewExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const targetKind = yield* toCliResult(resolveLinksV2ReviewRevokeTargetKind(rawTargetKind), ExitCodes.INVALID_ARGS);
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const result = yield* toCliResult(
      await revokeLinksV2ReviewOverride(ctx, database, profile, targetKind, targetId),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2ReviewRevokeOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
      targetId,
      targetKind,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2ReviewRevokeOutput(output, config));
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
      await acceptLinksV2AssetIdentityOverride(ctx, database, profile, {
        assetIdA: prepared.assetIdA,
        assetIdB: prepared.assetIdB,
        evidenceKind: prepared.evidenceKind,
        relationshipKind: prepared.relationshipKind,
      }),
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

async function executePreparedLinksV2AssetIdentityRevokeCommand(
  ctx: CommandRuntime,
  prepared: LinksV2AssetIdentityRevokeCommandOptions,
  config: LinksV2AssetIdentityExecutionConfig
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const result = yield* toCliResult(
      await revokeLinksV2AssetIdentityOverride(ctx, database, profile, {
        assetIdA: prepared.assetIdA,
        assetIdB: prepared.assetIdB,
        relationshipKind: prepared.relationshipKind,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2AssetIdentityRevokeOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      result,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2AssetIdentityRevokeOutput(output, config));
  });
}

async function acceptLinksV2AssetIdentityOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  assertion: LedgerLinkingAssetIdentityAssertion
): Promise<Result<LinksV2AssetIdentityAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    const canonicalPair = yield* canonicalizeLedgerLinkingAssetIdentityPair(assertion.assetIdA, assertion.assetIdB);
    const canonicalAssertion: LedgerLinkingAssetIdentityAssertion = {
      ...assertion,
      ...canonicalPair,
    };
    const overrideStore = new OverrideStore(ctx.dataDir);
    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-asset-identity-accept',
      payload: {
        asset_id_a: canonicalAssertion.assetIdA,
        asset_id_b: canonicalAssertion.assetIdB,
        evidence_kind: canonicalAssertion.evidenceKind,
        relationship_kind: canonicalAssertion.relationshipKind,
        type: 'ledger_linking_asset_identity_accept',
      },
    });
    const materialization = yield* await materializeStoredLedgerLinkingAssetIdentityAssertions(
      buildLedgerLinkingAssetIdentityAssertionStore(database),
      overrideStore,
      profile.id,
      profile.profileKey
    );

    return {
      assertion: canonicalAssertion,
      materialization,
      overrideEvent,
    };
  });
}

async function revokeLinksV2AssetIdentityOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  assertionTarget: Pick<LedgerLinkingAssetIdentityAssertion, 'assetIdA' | 'assetIdB' | 'relationshipKind'>
): Promise<Result<LinksV2AssetIdentityRevokeResult, Error>> {
  return resultDoAsync(async function* () {
    const canonicalPair = yield* canonicalizeLedgerLinkingAssetIdentityPair(
      assertionTarget.assetIdA,
      assertionTarget.assetIdB
    );
    const overrideStore = new OverrideStore(ctx.dataDir);
    const currentAssertions = yield* await readLedgerLinkingAssetIdentityAssertionOverrides(
      overrideStore,
      profile.profileKey
    );
    const assertion = currentAssertions.find(
      (item) =>
        item.assetIdA === canonicalPair.assetIdA &&
        item.assetIdB === canonicalPair.assetIdB &&
        item.relationshipKind === assertionTarget.relationshipKind
    );

    if (assertion === undefined) {
      return yield* err(
        new Error(
          `No accepted links-v2 asset identity assertion found for ${canonicalPair.assetIdA} <-> ${canonicalPair.assetIdB} (${assertionTarget.relationshipKind})`
        )
      );
    }

    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-asset-identity-revoke',
      payload: {
        asset_id_a: canonicalPair.assetIdA,
        asset_id_b: canonicalPair.assetIdB,
        relationship_kind: assertion.relationshipKind,
        type: 'ledger_linking_asset_identity_revoke',
      },
      reason: 'Revoked links-v2 asset identity assertion',
    });
    const materialization = yield* await materializeStoredLedgerLinkingAssetIdentityAssertions(
      buildLedgerLinkingAssetIdentityAssertionStore(database),
      overrideStore,
      profile.id,
      profile.profileKey
    );

    return {
      assertion,
      materialization,
      overrideEvent,
    };
  });
}

async function acceptLinksV2ReviewItem(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  reviewItem: LedgerLinkingReviewItem
): Promise<Result<LinksV2ReviewAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    switch (reviewItem.kind) {
      case 'asset_identity_suggestion':
        return {
          kind: 'asset_identity' as const,
          result: yield* await acceptLinksV2AssetIdentityOverride(ctx, database, profile, {
            assetIdA: reviewItem.suggestion.assetIdA,
            assetIdB: reviewItem.suggestion.assetIdB,
            evidenceKind: reviewItem.suggestion.evidenceKind,
            relationshipKind: reviewItem.suggestion.relationshipKind,
          }),
        };
      case 'link_proposal':
        return {
          kind: 'link_proposal' as const,
          result: yield* await acceptLinksV2LinkProposalOverride(ctx, database, profile, reviewItem),
        };
      case 'gap_resolution':
        return {
          kind: 'gap_resolution' as const,
          result: yield* await acceptLinksV2GapResolutionOverride(ctx, profile, reviewItem),
        };
    }
  });
}

function resolveLinksV2ReviewRevokeTargetKind(rawTargetKind: string): Result<LinksV2ReviewRevokeTargetKind, Error> {
  const parsed = LinksV2ReviewRevokeTargetKindSchema.safeParse(rawTargetKind);
  if (!parsed.success) {
    return err(new Error("Review revoke target kind must be 'relationship' or 'gap-resolution'"));
  }

  return ok(parsed.data);
}

async function revokeLinksV2ReviewOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  targetKind: LinksV2ReviewRevokeTargetKind,
  targetId: string
): Promise<Result<LinksV2ReviewRevokeResult, Error>> {
  switch (targetKind) {
    case 'relationship':
      return resultDoAsync(async function* () {
        return {
          kind: 'relationship' as const,
          result: yield* await revokeLinksV2RelationshipOverride(ctx, database, profile, targetId),
        };
      });
    case 'gap-resolution':
      return resultDoAsync(async function* () {
        return {
          kind: 'gap_resolution' as const,
          result: yield* await revokeLinksV2GapResolutionOverride(ctx, profile, targetId),
        };
      });
  }
}

async function acceptLinksV2LinkProposalOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  reviewItem: Extract<LedgerLinkingReviewItem, { kind: 'link_proposal' }>
): Promise<Result<LinksV2RelationshipAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    const payload = buildLinksV2RelationshipAcceptPayload(reviewItem);

    return yield* await acceptLinksV2RelationshipOverridePayload(ctx, database, profile, payload);
  });
}

async function createLinksV2ManualRelationshipOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  options: LinksV2ReviewCreateRelationshipCommandOptions
): Promise<Result<LinksV2RelationshipAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    const candidates = yield* await loadLinksV2ManualRelationshipCandidates(database, profile.id);
    const payload = yield* buildLinksV2ManualRelationshipAcceptPayload({
      candidates,
      reason: options.reason,
      relationshipKind: options.relationshipKind,
      sourcePostingFingerprint: options.sourcePosting,
      sourceQuantity: options.sourceQuantity,
      targetPostingFingerprint: options.targetPosting,
      targetQuantity: options.targetQuantity,
    });

    return yield* await acceptLinksV2RelationshipOverridePayload(ctx, database, profile, payload);
  });
}

async function acceptLinksV2RelationshipOverridePayload(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  payload: LedgerLinkingRelationshipAcceptPayload
): Promise<Result<LinksV2RelationshipAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    const overrideStore = new OverrideStore(ctx.dataDir);
    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-relationship-accept',
      payload,
    });
    const reviewedOverride = yield* toReviewedRelationshipOverride(overrideEvent, payload);
    const relationshipStableKey = buildReviewedLedgerLinkingRelationshipStableKey(reviewedOverride);
    const run = yield* await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database, { overrideStore }), {
      dryRun: false,
      includeDiagnostics: true,
    });

    if (
      !run.reviewedRelationshipOverrideMatches.some((match) => match.relationshipStableKey === relationshipStableKey)
    ) {
      return yield* err(
        new Error(`Accepted links-v2 relationship override ${relationshipStableKey} was not materialized by the runner`)
      );
    }

    return {
      overrideEvent,
      relationshipKind: payload.relationship_kind,
      relationshipStableKey,
      run,
      sourcePostingFingerprint: resolveFirstRelationshipAllocationPosting(payload, 'source'),
      targetPostingFingerprint: resolveFirstRelationshipAllocationPosting(payload, 'target'),
    };
  });
}

async function loadLinksV2ManualRelationshipCandidates(
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profileId: number
): Promise<Result<LedgerTransferLinkingCandidate[], Error>> {
  return resultDoAsync(async function* () {
    const postingInputs =
      yield* await buildLedgerLinkingCandidateSourceReader(database).loadLedgerLinkingPostingInputs(profileId);
    const candidateBuild = yield* buildLedgerTransferLinkingCandidates(postingInputs);

    return candidateBuild.candidates;
  });
}

function resolveFirstRelationshipAllocationPosting(
  payload: LedgerLinkingRelationshipAcceptPayload,
  side: 'source' | 'target'
): string {
  const allocation = payload.allocations.find((item) => item.allocation_side === side);
  if (allocation === undefined) {
    throw new Error(`Accepted links-v2 relationship payload is missing a ${side} allocation`);
  }

  return allocation.posting_fingerprint;
}

async function revokeLinksV2RelationshipOverride(
  ctx: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['openDatabaseSession']>>,
  profile: LinksV2CommandProfile,
  relationshipStableKey: string
): Promise<Result<LinksV2RelationshipRevokeResult, Error>> {
  return resultDoAsync(async function* () {
    const overrideStore = new OverrideStore(ctx.dataDir);
    const reviewedRelationships = yield* await readLedgerLinkingRelationshipOverrides(
      overrideStore,
      profile.profileKey
    );
    if (
      !reviewedRelationships.some(
        (relationship) => buildReviewedLedgerLinkingRelationshipStableKey(relationship) === relationshipStableKey
      )
    ) {
      return yield* err(
        new Error(`No accepted reviewed links-v2 relationship override found for ${relationshipStableKey}`)
      );
    }

    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-relationship-revoke',
      payload: {
        relationship_stable_key: relationshipStableKey,
        type: 'ledger_linking_relationship_revoke',
      },
      reason: 'Revoked links-v2 reviewed relationship override',
    });
    const run = yield* await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database, { overrideStore }), {
      dryRun: false,
      includeDiagnostics: true,
    });

    if (
      run.reviewedRelationshipOverrideMatches.some((match) => match.relationshipStableKey === relationshipStableKey)
    ) {
      return yield* err(
        new Error(
          `Revoked links-v2 relationship override ${relationshipStableKey} was still materialized by the runner`
        )
      );
    }

    return {
      overrideEvent,
      relationshipStableKey,
      run,
    };
  });
}

async function acceptLinksV2GapResolutionOverride(
  ctx: CommandRuntime,
  profile: LinksV2CommandProfile,
  reviewItem: Extract<LedgerLinkingReviewItem, { kind: 'gap_resolution' }>
): Promise<Result<LinksV2GapResolutionAcceptResult, Error>> {
  return resultDoAsync(async function* () {
    const overrideStore = new OverrideStore(ctx.dataDir);
    const payload = buildLinksV2GapResolutionAcceptPayload(reviewItem);
    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-gap-resolution-accept',
      payload,
      reason: formatGapResolutionKind(payload.resolution_kind),
    });

    return {
      overrideEvent,
      resolutionKey: buildLedgerLinkingGapResolutionKey(reviewItem.resolution.candidate),
    };
  });
}

async function revokeLinksV2GapResolutionOverride(
  ctx: CommandRuntime,
  profile: LinksV2CommandProfile,
  postingFingerprint: string
): Promise<Result<LinksV2GapResolutionRevokeResult, Error>> {
  return resultDoAsync(async function* () {
    const overrideStore = new OverrideStore(ctx.dataDir);
    const resolutionKey = buildLedgerLinkingGapResolutionKey({ postingFingerprint });
    const resolutions = yield* await readResolvedLedgerLinkingGapResolutions(overrideStore, profile.profileKey);

    if (!resolutions.has(resolutionKey)) {
      return yield* err(new Error(`No accepted links-v2 gap resolution found for posting ${postingFingerprint}`));
    }

    const overrideEvent = yield* await overrideStore.append({
      profileKey: profile.profileKey,
      scope: 'ledger-linking-gap-resolution-revoke',
      payload: {
        posting_fingerprint: postingFingerprint,
        type: 'ledger_linking_gap_resolution_revoke',
      },
      reason: 'Revoked links-v2 gap resolution',
    });

    return {
      overrideEvent,
      resolutionKey,
    };
  });
}

function buildLinksV2RelationshipAcceptPayload(
  reviewItem: Extract<LedgerLinkingReviewItem, { kind: 'link_proposal' }>
): LedgerLinkingRelationshipAcceptPayload {
  const { proposal } = reviewItem;

  return {
    allocations: [
      {
        allocation_side: 'source',
        asset_id: proposal.source.assetId,
        asset_symbol: proposal.source.assetSymbol,
        journal_fingerprint: proposal.source.journalFingerprint,
        posting_fingerprint: proposal.source.postingFingerprint,
        quantity: proposal.amount,
        source_activity_fingerprint: proposal.source.sourceActivityFingerprint,
      },
      {
        allocation_side: 'target',
        asset_id: proposal.target.assetId,
        asset_symbol: proposal.target.assetSymbol,
        journal_fingerprint: proposal.target.journalFingerprint,
        posting_fingerprint: proposal.target.postingFingerprint,
        quantity: proposal.amount,
        source_activity_fingerprint: proposal.target.sourceActivityFingerprint,
      },
    ],
    evidence: {
      assetIdentityReason: proposal.assetIdentityReason,
      matchedAmount: proposal.amount,
      proposalUniqueness: proposal.uniqueness,
      timeDirection: proposal.timeDirection,
      timeDistanceSeconds: proposal.timeDistanceSeconds,
    },
    proposal_kind: reviewItem.proposalKind,
    relationship_kind: reviewItem.relationshipKind,
    review_id: reviewItem.reviewId,
    type: 'ledger_linking_relationship_accept',
  };
}

function toReviewedRelationshipOverride(
  overrideEvent: OverrideEvent,
  payload: LedgerLinkingRelationshipAcceptPayload
): Result<LedgerLinkingReviewedRelationshipOverride, Error> {
  const parsed = LedgerLinkingReviewedRelationshipOverrideSchema.safeParse({
    acceptedAt: overrideEvent.created_at,
    allocations: payload.allocations.map((allocation) => ({
      allocationSide: allocation.allocation_side,
      assetId: allocation.asset_id,
      assetSymbol: allocation.asset_symbol,
      journalFingerprint: allocation.journal_fingerprint,
      postingFingerprint: allocation.posting_fingerprint,
      quantity: new Decimal(allocation.quantity),
      sourceActivityFingerprint: allocation.source_activity_fingerprint,
    })),
    evidence: payload.evidence,
    overrideEventId: overrideEvent.id,
    proposalKind: payload.proposal_kind,
    relationshipKind: payload.relationship_kind,
    reviewId: payload.review_id,
  });

  if (!parsed.success) {
    return err(new Error(`Invalid accepted links-v2 relationship override: ${parsed.error.message}`));
  }

  return ok(parsed.data);
}

function buildLinksV2GapResolutionAcceptPayload(
  reviewItem: Extract<LedgerLinkingReviewItem, { kind: 'gap_resolution' }>
): LedgerLinkingGapResolutionAcceptPayload {
  const { candidate, resolutionKind } = reviewItem.resolution;

  return {
    asset_id: candidate.assetId,
    asset_symbol: candidate.assetSymbol,
    claimed_amount: candidate.claimedAmount,
    direction: candidate.direction,
    journal_fingerprint: candidate.journalFingerprint,
    original_amount: candidate.originalAmount,
    platform_key: candidate.platformKey,
    platform_kind: candidate.platformKind,
    posting_fingerprint: candidate.postingFingerprint,
    remaining_amount: candidate.remainingAmount,
    resolution_kind: resolutionKind,
    review_id: reviewItem.reviewId,
    source_activity_fingerprint: candidate.sourceActivityFingerprint,
    type: 'ledger_linking_gap_resolution_accept',
  };
}

async function readLinksV2ResolvedGapResolutionKeys(
  ctx: CommandRuntime,
  profile: LinksV2CommandProfile
): Promise<Result<Set<string>, Error>> {
  const overrideStore = new OverrideStore(ctx.dataDir);
  return readResolvedLedgerLinkingGapResolutionKeys(overrideStore, profile.profileKey);
}

function buildLinksV2ReviewQueueFromRun(
  run: LedgerLinkingRunResult,
  resolvedGapResolutionKeys?: ReadonlySet<string>
): Result<LedgerLinkingReviewQueue, Error> {
  if (run.diagnostics === undefined) {
    return err(new Error('Links v2 review diagnostics were not returned by the ledger-linking runner'));
  }

  return ok(
    buildLedgerLinkingReviewQueue({
      assetIdentitySuggestions: run.assetIdentitySuggestions,
      diagnostics: run.diagnostics,
      resolvedGapResolutionKeys,
    })
  );
}

function resolveLinksV2ReviewItem(
  rawReviewId: string,
  reviewItems: readonly LedgerLinkingReviewItem[]
): Result<LedgerLinkingReviewItem, CliFailure> {
  const reviewId = rawReviewId.trim();
  if (reviewId.length === 0) {
    return cliErr(new Error('Review id must not be empty'), ExitCodes.INVALID_ARGS);
  }

  const reviewItem = reviewItems.find((item) => item.reviewId === reviewId);
  if (reviewItem === undefined) {
    return cliErr(
      new Error(`No links-v2 review item matched "${reviewId}". Run "links-v2 review" to see current review ids.`),
      ExitCodes.INVALID_ARGS
    );
  }

  return ok(reviewItem);
}

function renderLinksV2ReviewOutput(output: LinksV2ReviewOutput, config: LinksV2ReviewExecutionConfig): void {
  const { profile, reviewQueue } = output;

  console.log(config.title);
  console.log('Mode: dry run');
  console.log(`Profile: ${profile.profileKey} (#${profile.id})`);
  console.log(
    `Review items: ${reviewQueue.shownItemCount} of ${reviewQueue.itemCount} (${formatPlural(reviewQueue.assetIdentitySuggestionCount, 'asset identity suggestion', 'asset identity suggestions')}, ${formatPlural(reviewQueue.linkProposalCount, 'link proposal', 'link proposals')}, ${formatPlural(reviewQueue.gapResolutionCount, 'gap resolution', 'gap resolutions')})`
  );

  if (reviewQueue.itemCount === 0) {
    console.log('No pending links-v2 review items.');
    return;
  }

  for (const item of reviewQueue.items) {
    renderLinksV2ReviewItem(item);
  }

  console.log('Inspect before accepting: exitbook links-v2 review view <review-id>');
}

function renderLinksV2ReviewViewOutput(output: LinksV2ReviewViewOutput, config: LinksV2ReviewExecutionConfig): void {
  const { reviewItem } = output;

  console.log(config.title);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Review id: ${reviewItem.reviewId}`);
  console.log(`Kind: ${reviewItem.kind}`);
  console.log(`Evidence strength: ${reviewItem.evidenceStrength}`);

  if (reviewItem.kind === 'asset_identity_suggestion') {
    renderLinksV2AssetIdentityReviewDetail(reviewItem);
    return;
  }

  if (reviewItem.kind === 'link_proposal') {
    renderLinksV2LinkProposalReviewDetail(reviewItem);
    return;
  }

  renderLinksV2GapResolutionReviewDetail(reviewItem);
}

function renderLinksV2ReviewAcceptOutput(
  output: LinksV2ReviewAcceptOutput,
  config: LinksV2ReviewExecutionConfig
): void {
  console.log(config.title);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Review id: ${output.reviewId}`);

  if (output.result.kind === 'asset_identity') {
    const { assertion, materialization, overrideEvent } = output.result.result;
    if (output.reviewItem.kind !== 'asset_identity_suggestion') {
      throw new Error(`Expected asset identity review item for accepted result ${output.reviewId}`);
    }

    const { suggestion } = output.reviewItem;
    console.log('Action: asset identity override accepted');
    console.log(`Override event: ${overrideEvent.id}`);
    console.log(`Relationship kind: ${assertion.relationshipKind}`);
    console.log(`Assets: ${assertion.assetIdA} <-> ${assertion.assetIdB}`);
    console.log(`Evidence: ${assertion.evidenceKind}`);
    console.log(`Observed blockers: ${suggestion.blockCount}`);
    console.log(
      `Materialized assertions: ${materialization.savedCount} saved, ${materialization.previousCount} replaced`
    );
    return;
  }

  if (output.result.kind === 'link_proposal') {
    const { overrideEvent, relationshipStableKey, run } = output.result.result;
    console.log(`Override event: ${overrideEvent.id}`);
    console.log('Action: reviewed link override accepted');
    console.log(`Relationship stable key: ${relationshipStableKey}`);
    if (run.persistence.mode === 'persisted') {
      console.log(
        `Materialized relationships: ${run.persistence.materialization.savedCount} saved, ${run.persistence.materialization.previousCount} replaced`
      );
    }
    return;
  }

  const { overrideEvent, resolutionKey } = output.result.result;
  if (output.reviewItem.kind !== 'gap_resolution') {
    throw new Error(`Expected gap resolution review item for accepted result ${output.reviewId}`);
  }
  console.log(`Override event: ${overrideEvent.id}`);
  console.log('Action: gap resolution accepted');
  console.log(`Resolution key: ${resolutionKey}`);
  console.log(`Resolution: ${formatGapResolutionKind(output.reviewItem.resolution.resolutionKind)}`);
}

function renderLinksV2ReviewRevokeOutput(
  output: LinksV2ReviewRevokeOutput,
  config: LinksV2ReviewExecutionConfig
): void {
  console.log(config.title);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);

  if (output.result.kind === 'relationship') {
    const { overrideEvent, relationshipStableKey, run } = output.result.result;
    console.log('Action: reviewed link override revoked');
    console.log(`Override event: ${overrideEvent.id}`);
    console.log(`Relationship stable key: ${relationshipStableKey}`);
    if (run.persistence.mode === 'persisted') {
      console.log(
        `Materialized relationships: ${run.persistence.materialization.savedCount} saved, ${run.persistence.materialization.previousCount} replaced`
      );
    }
    return;
  }

  const { overrideEvent, resolutionKey } = output.result.result;
  console.log('Action: gap resolution revoked');
  console.log(`Override event: ${overrideEvent.id}`);
  console.log(`Resolution key: ${resolutionKey}`);
}

function renderLinksV2AssetIdentityReviewDetail(
  item: Extract<LedgerLinkingReviewItem, { kind: 'asset_identity_suggestion' }>
): void {
  const { suggestion } = item;

  console.log(`Relationship kind: ${suggestion.relationshipKind}`);
  console.log(`Asset symbol: ${suggestion.assetSymbol}`);
  console.log(`Assets: ${suggestion.assetIdA} <-> ${suggestion.assetIdB}`);
  console.log(`Evidence: ${formatAssetIdentityEvidenceKind(suggestion.evidenceKind)}`);
  console.log(`Observed blockers: ${suggestion.blockCount}`);
  console.log(`Would accept: asset identity assertion ${suggestion.assetIdA} <-> ${suggestion.assetIdB}`);
  console.log('Impact:');
  console.log(formatAssetIdentityAcceptImpact(suggestion.evidenceKind));
  console.log(`Accept command: exitbook links-v2 review accept ${item.reviewId}`);
  console.log('Decision help:');
  console.log(formatAssetIdentityDecisionHelp(suggestion.evidenceKind));
  console.log('Examples:');
  for (const example of suggestion.examples) {
    console.log(`  ${formatAssetIdentitySuggestionExample(suggestion, example)}`);
    console.log(`    source posting: ${shortenValue(example.sourcePostingFingerprint)}`);
    console.log(`    target posting: ${shortenValue(example.targetPostingFingerprint)}`);
  }
}

function renderLinksV2LinkProposalReviewDetail(
  item: Extract<LedgerLinkingReviewItem, { kind: 'link_proposal' }>
): void {
  const { proposal } = item;

  console.log(`Proposal kind: ${item.proposalKind}`);
  console.log(`Relationship kind: ${item.relationshipKind}`);
  console.log(`Asset: ${proposal.amount} ${proposal.assetSymbol}`);
  console.log(`Uniqueness: ${proposal.uniqueness}`);
  console.log(
    `Source: ${proposal.source.platformKey} #${proposal.source.candidateId} ${formatDate(proposal.source.activityDatetime)}`
  );
  console.log(
    `Target: ${proposal.target.platformKey} #${proposal.target.candidateId} ${formatDate(proposal.target.activityDatetime)}`
  );
  console.log(`Source asset id: ${proposal.source.assetId}`);
  console.log(`Target asset id: ${proposal.target.assetId}`);
  console.log(`Time evidence: ${formatDurationSeconds(proposal.timeDistanceSeconds)}, ${proposal.timeDirection}`);
  console.log(`Asset identity: ${formatAssetIdentityReason(proposal.assetIdentityReason)}`);
  console.log(
    `Would accept: reviewed ${item.proposalKind} relationship ${proposal.source.postingFingerprint} -> ${proposal.target.postingFingerprint}`
  );
  console.log(`Accept command: exitbook links-v2 review accept ${item.reviewId}`);
  console.log('Decision help:');
  console.log('  This records a durable reviewed relationship override.');
  console.log('  Replay requires every accepted posting allocation and quantity to still resolve.');
}

function renderLinksV2GapResolutionReviewDetail(
  item: Extract<LedgerLinkingReviewItem, { kind: 'gap_resolution' }>
): void {
  const { candidate, classifications, resolutionKind } = item.resolution;

  console.log(`Resolution: ${formatGapResolutionKind(resolutionKind)}`);
  console.log(`Asset: ${candidate.remainingAmount} ${candidate.assetSymbol}`);
  console.log(`Direction: ${formatCandidateDirection(candidate.direction)}`);
  console.log(`Platform: ${candidate.platformKey} (${candidate.platformKind})`);
  console.log(`Activity: ${formatDate(candidate.activityDatetime)}`);
  console.log(`Posting: ${candidate.postingFingerprint}`);
  console.log(`Original amount: ${candidate.originalAmount}`);
  console.log(`Already linked amount: ${candidate.claimedAmount}`);
  console.log(`Classifications: ${classifications.join(', ')}`);
  console.log(`Would accept: resolved non-link posting ${candidate.postingFingerprint}`);
  console.log(`Accept command: exitbook links-v2 review accept ${item.reviewId}`);
  console.log('Decision help:');
  console.log('  This records a durable gap-resolution override; it does not create a relationship.');
  console.log('  Accept only when this posting should intentionally remain unlinked.');
}

function renderLinksV2ReviewCreateRelationshipOutput(
  output: LinksV2ReviewCreateRelationshipOutput,
  config: LinksV2ReviewExecutionConfig
): void {
  const { overrideEvent, relationshipKind, relationshipStableKey, run } = output.result;

  console.log(config.title);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log('Action: manual reviewed link override accepted');
  console.log(`Override event: ${overrideEvent.id}`);
  console.log(`Relationship kind: ${relationshipKind}`);
  console.log(`Relationship stable key: ${relationshipStableKey}`);
  console.log(`Source posting: ${output.result.sourcePostingFingerprint}`);
  console.log(`Target posting: ${output.result.targetPostingFingerprint}`);
  if (run.persistence.mode === 'persisted') {
    console.log(
      `Materialized relationships: ${run.persistence.materialization.savedCount} saved, ${run.persistence.materialization.previousCount} replaced`
    );
  }
}

function renderLinksV2ReviewItem(item: LedgerLinkingReviewItem): void {
  switch (item.kind) {
    case 'asset_identity_suggestion':
      renderLinksV2AssetIdentityReviewItem(item);
      return;
    case 'link_proposal':
      renderLinksV2LinkProposalReviewItem(item);
      return;
    case 'gap_resolution':
      renderLinksV2GapResolutionReviewItem(item);
      return;
  }
}

function renderLinksV2AssetIdentityReviewItem(
  item: Extract<LedgerLinkingReviewItem, { kind: 'asset_identity_suggestion' }>
): void {
  const { suggestion } = item;

  console.log(
    `  ${item.reviewId} asset_identity_suggestion ${suggestion.relationshipKind} ${suggestion.assetSymbol} (${item.evidenceStrength})`
  );
  console.log(`    assets: ${suggestion.assetIdA} <-> ${suggestion.assetIdB}`);
  console.log(
    `    evidence: ${formatAssetIdentityEvidenceKind(suggestion.evidenceKind)}, ${suggestion.blockCount} blocker(s)`
  );
  for (const example of suggestion.examples) {
    console.log(`    ${formatAssetIdentitySuggestionExample(suggestion, example)}`);
  }
}

function renderLinksV2LinkProposalReviewItem(item: Extract<LedgerLinkingReviewItem, { kind: 'link_proposal' }>): void {
  const { proposal } = item;

  console.log(
    `  ${item.reviewId} link_proposal ${item.proposalKind} ${proposal.uniqueness} ${proposal.assetSymbol} ${proposal.amount} (${item.evidenceStrength})`
  );
  console.log(
    `    source: ${proposal.source.platformKey} #${proposal.source.candidateId} ${formatDate(proposal.source.activityDatetime)} ${shortenValue(proposal.source.postingFingerprint)}`
  );
  console.log(
    `    target: ${proposal.target.platformKey} #${proposal.target.candidateId} ${formatDate(proposal.target.activityDatetime)} ${shortenValue(proposal.target.postingFingerprint)}`
  );
  console.log(
    `    evidence: time ${formatDurationSeconds(proposal.timeDistanceSeconds)}, ${proposal.timeDirection}, ${formatAssetIdentityReason(proposal.assetIdentityReason)}`
  );
}

function renderLinksV2GapResolutionReviewItem(
  item: Extract<LedgerLinkingReviewItem, { kind: 'gap_resolution' }>
): void {
  const { candidate, resolutionKind } = item.resolution;

  console.log(
    `  ${item.reviewId} gap_resolution ${formatGapResolutionKind(resolutionKind)} ${candidate.assetSymbol} ${candidate.remainingAmount} (${item.evidenceStrength})`
  );
  console.log(
    `    posting: ${candidate.platformKey} #${candidate.candidateId} ${formatDate(candidate.activityDatetime)} ${shortenValue(candidate.postingFingerprint)}`
  );
  console.log(
    `    evidence: ${formatCandidateDirection(candidate.direction)}, original ${candidate.originalAmount}, linked ${candidate.claimedAmount}`
  );
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
  console.log(`Fee-adjusted exact-hash matches: ${run.feeAdjustedExactHashMatches.length}`);
  console.log(`Fee-adjusted exact-hash ambiguities: ${run.feeAdjustedExactHashAmbiguities.length}`);
  console.log(`Fee-adjusted exact-hash asset identity blocks: ${run.feeAdjustedExactHashAssetIdentityBlocks.length}`);
  console.log(`Same-hash grouped matches: ${run.sameHashGroupedMatches.length}`);
  console.log(`Same-hash unresolved groups: ${run.sameHashGroupedUnresolvedGroups.length}`);
  console.log(`Counterparty roundtrip matches: ${run.counterpartyRoundtripMatches.length}`);
  console.log(`Counterparty roundtrip ambiguities: ${run.counterpartyRoundtripAmbiguities.length}`);
  console.log(`Strict exchange amount/time matches: ${run.strictExchangeAmountTimeTransferMatches.length}`);
  console.log(`Strict exchange amount/time ambiguities: ${run.strictExchangeAmountTimeTransferAmbiguities.length}`);
  console.log(`Reviewed relationship overrides: ${run.reviewedRelationshipOverrideMatches.length}`);
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
    `Evidence: ${output.exactHashAssetIdentityBlockCount} exact-hash blocker(s), ${output.feeAdjustedExactHashAssetIdentityBlockCount} fee-adjusted exact-hash blocker(s), ${output.amountTimeAssetIdentityBlockerCount} amount/time blocker(s)`
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
  const { assertion, materialization, overrideEvent } = output.result;

  console.log(`${config.label} asset identity override accepted.`);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Override event: ${overrideEvent.id}`);
  console.log(`Relationship kind: ${assertion.relationshipKind}`);
  console.log(`Assets: ${assertion.assetIdA} <-> ${assertion.assetIdB}`);
  console.log(`Evidence: ${assertion.evidenceKind}`);
  console.log(
    `Materialized assertions: ${materialization.savedCount} saved, ${materialization.previousCount} replaced`
  );
}

function renderLinksV2AssetIdentityRevokeOutput(
  output: LinksV2AssetIdentityRevokeOutput,
  config: LinksV2AssetIdentityExecutionConfig
): void {
  const { assertion, materialization, overrideEvent } = output.result;

  console.log(`${config.label} asset identity override revoked.`);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Override event: ${overrideEvent.id}`);
  console.log(`Relationship kind: ${assertion.relationshipKind}`);
  console.log(`Assets: ${assertion.assetIdA} <-> ${assertion.assetIdB}`);
  console.log(`Evidence: ${assertion.evidenceKind}`);
  console.log(
    `Materialized assertions: ${materialization.savedCount} saved, ${materialization.previousCount} replaced`
  );
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

function formatPlural(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCandidateDirection(direction: 'source' | 'target'): string {
  return direction === 'source' ? 'outflow' : 'inflow';
}

function formatGapResolutionKind(kind: LedgerLinkingGapResolutionAcceptPayload['resolution_kind']): string {
  switch (kind) {
    case 'accepted_transfer_residual':
      return 'accepted transfer residual';
    case 'fiat_cash_movement':
      return 'fiat cash movement';
    case 'likely_dust_airdrop':
      return 'likely dust airdrop';
    case 'likely_spam_airdrop':
      return 'likely spam airdrop';
  }
}

function formatAssetIdentitySuggestionExample(
  suggestion: LedgerLinkingAssetIdentitySuggestion,
  example: LedgerLinkingAssetIdentitySuggestion['examples'][number]
): string {
  const details: string[] = [`example: ${example.amount} ${suggestion.assetSymbol}`];

  if (example.sourceAmount !== undefined && example.targetAmount !== undefined) {
    details.push(`source ${example.sourceAmount}, target ${example.targetAmount}`);
  }

  if (example.residualAmount !== undefined && example.residualSide !== undefined) {
    details.push(`residual ${example.residualAmount} on ${example.residualSide}`);
  }

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

function formatAssetIdentityDecisionHelp(evidenceKind: LedgerLinkingAssetIdentitySuggestion['evidenceKind']): string {
  switch (evidenceKind) {
    case 'exact_hash_observed':
      return [
        '  Accept only if the two shown asset ids name the same asset.',
        '  Exact-hash evidence means the same transaction hash was observed on both sides.',
        '  If source/target amounts differ, only the arrived amount is linkable; the residual stays unresolved.',
        '  If a blockchain asset id is involved, verify the network/token matches the exchange asset.',
        '  If the asset mapping is unclear, leave it pending; no relationship will be created from this identity.',
      ].join('\n');
    case 'amount_time_observed':
      return [
        '  Amount/time evidence is weaker: matching amounts and timing do not prove asset identity.',
        '  Accept only after checking the two shown asset ids name the same asset.',
        '  If a blockchain asset id is involved, verify the network/token matches the exchange asset.',
        '  If unsure, leave it pending; this is safer than converting a symbol match into accounting truth.',
      ].join('\n');
  }
}

function formatAssetIdentityAcceptImpact(evidenceKind: LedgerLinkingAssetIdentitySuggestion['evidenceKind']): string {
  switch (evidenceKind) {
    case 'exact_hash_observed':
      return [
        '  Records only the asset identity assertion.',
        '  A later links-v2 run can use that assertion to materialize deterministic exact-hash or fee-adjusted exact-hash relationships.',
      ].join('\n');
    case 'amount_time_observed':
      return [
        '  Records only the asset identity assertion.',
        '  A later reviewed link accept can materialize amount/time proposals for this asset pair.',
      ].join('\n');
  }
}

function formatAssetIdentityReason(reason: 'accepted_assertion' | 'same_asset_id'): string {
  switch (reason) {
    case 'accepted_assertion':
      return 'accepted asset identity assertion';
    case 'same_asset_id':
      return 'same asset id';
  }
}

function formatAssetIdentitySuggestionHash(
  example: LedgerLinkingAssetIdentitySuggestion['examples'][number]
): string | undefined {
  if (example.sourceBlockchainTransactionHash === undefined || example.targetBlockchainTransactionHash === undefined) {
    return undefined;
  }

  if (ledgerTransactionHashesMatch(example.sourceBlockchainTransactionHash, example.targetBlockchainTransactionHash)) {
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
