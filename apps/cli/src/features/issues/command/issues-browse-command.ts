import type {
  AccountingIssueDetailItem,
  AccountingIssueScopeSummary,
  AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import { buildProfileAccountingIssueScopeSnapshot } from '@exitbook/accounting/issues';
import { loadProfileAccountingIssueSourceData } from '@exitbook/data/accounting';
import { buildProfileProjectionScopeKey } from '@exitbook/data/projections';
import { err, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  cliErr,
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  toCliValue,
  type CliFailure,
} from '../../../cli/command.js';
import {
  detectCliOutputFormat,
  parseCliBrowseRootInvocationResult,
  parseCliCommandOptionsResult,
  type CliOutputFormat,
} from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  ensureAssetReviewReady,
  ensureLinksReady,
  ensureProcessedTransactionsReady,
} from '../../../runtime/projection-readiness.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { JsonFlagSchema } from '../../shared/option-schema-primitives.js';
import { getIssueSelectorErrorExitCode, resolveIssueSelector, buildIssueSelector } from '../issue-selector.js';
import {
  outputIssuesStaticDetail,
  outputIssuesStaticOverview,
  type IssuesStaticDetailState,
  type IssuesStaticOverviewState,
} from '../view/issues-static-renderer.js';

interface IssueSummaryRecord {
  issueKey: string;
  issue: AccountingIssueSummaryItem;
}

interface MaterializedProfileIssuesData {
  profileDisplayName: string;
  scope: AccountingIssueScopeSummary;
  issueRecords: IssueSummaryRecord[];
}

interface IssuesOverviewData extends MaterializedProfileIssuesData {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
}

interface IssuesViewData extends IssuesOverviewData {
  issue: AccountingIssueDetailItem;
}

export function registerIssuesBrowseOptions(command: Command): Command {
  return command.option('--json', 'Output results in JSON format');
}

export function parseIssuesBrowseRootInvocationResult(
  tokens: string[] | undefined
): Result<{ rawOptions: Record<string, unknown>; selector?: string | undefined }, CliFailure> {
  return parseCliBrowseRootInvocationResult(tokens, registerIssuesBrowseOptions);
}

export function buildIssuesRootSelectorError(selector: string): Result<never, CliFailure> {
  return cliErr(`Use "issues view ${selector}" for static detail.`, ExitCodes.INVALID_ARGS);
}

export async function runIssuesListCommand(commandId: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema);
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadIssuesOverviewData(runtime, prepared.json ? 'json' : 'text');

        if (prepared.json) {
          return jsonSuccess({
            summary: {
              openIssueCount: data.scope.openIssueCount,
              blockingIssueCount: data.scope.blockingIssueCount,
              status: data.scope.status,
            },
            currentIssues: data.issueRecords.map((record) => record.issue),
            scopedLenses: [],
          });
        }

        return textSuccess(() => {
          outputIssuesStaticOverview(toIssuesOverviewState(data));
        });
      }),
  });
}

export async function runIssuesViewCommand(commandId: string, selector: string, rawOptions: unknown): Promise<void> {
  await runCliRuntimeCommand({
    command: commandId,
    format: detectCliOutputFormat(rawOptions),
    prepare: async () =>
      resultDoAsync(async function* () {
        return {
          options: yield* parseCliCommandOptionsResult(rawOptions, JsonFlagSchema),
          selector,
        };
      }),
    action: async ({ runtime, prepared }) =>
      resultDoAsync(async function* () {
        const data = yield* await loadIssueViewData(
          runtime,
          prepared.options.json ? 'json' : 'text',
          prepared.selector
        );

        if (prepared.options.json) {
          return jsonSuccess(data.issue);
        }

        return textSuccess(() => {
          outputIssuesStaticDetail(toIssuesDetailState(data));
        });
      }),
  });
}

async function loadIssuesOverviewData(
  runtime: CommandRuntime,
  format: CliOutputFormat
): Promise<Result<IssuesOverviewData, CliFailure>> {
  return resultDoAsync(async function* () {
    const materialized = yield* await materializeCurrentProfileIssues(runtime, format);

    return {
      activeProfileKey: runtime.activeProfileKey,
      activeProfileSource: runtime.activeProfileSource,
      ...materialized,
    };
  });
}

async function loadIssueViewData(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  selector: string
): Promise<Result<IssuesViewData, CliFailure>> {
  return resultDoAsync(async function* () {
    const overview = yield* await loadIssuesOverviewData(runtime, format);
    const resolution = resolveIssueSelector(
      overview.issueRecords.map((record) => ({
        fullSelector: buildIssueSelector(overview.scope.scopeKey, record.issueKey),
        item: record,
      })),
      selector
    );
    if (resolution.isErr()) {
      return yield* err(createCliFailure(resolution.error, getIssueSelectorErrorExitCode(resolution.error)));
    }

    const db = await runtime.database();
    const detailResult = yield* toCliResult(
      await db.accountingIssues.findCurrentIssueDetail(overview.scope.scopeKey, resolution.value.item.issueKey),
      ExitCodes.GENERAL_ERROR
    );
    const detail = yield* toCliValue(
      detailResult,
      new Error(`Issue ref '${selector.trim().toLowerCase()}' not found`),
      ExitCodes.NOT_FOUND
    );

    return {
      ...overview,
      issue: detail.issue,
    };
  });
}

async function materializeCurrentProfileIssues(
  runtime: CommandRuntime,
  format: CliOutputFormat
): Promise<Result<MaterializedProfileIssuesData, CliFailure>> {
  return resultDoAsync(async function* () {
    const db = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, db), ExitCodes.GENERAL_ERROR);

    yield* toCliResult(
      await ensureProcessedTransactionsReady(runtime, {
        format,
        profileId: profile.id,
        profileKey: profile.profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );
    yield* toCliResult(
      await ensureAssetReviewReady(runtime, {
        profileId: profile.id,
        profileKey: profile.profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );
    yield* toCliResult(
      await ensureLinksReady(runtime, {
        format,
        profileId: profile.id,
        profileKey: profile.profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const scopeKey = buildProfileProjectionScopeKey(profile.id);
    const sourceData = yield* toCliResult(
      await loadProfileAccountingIssueSourceData(db, runtime.dataDir, {
        profileId: profile.id,
        profileKey: profile.profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: profile.id,
      scopeKey,
      title: profile.displayName,
      assetReviewSummaries: sourceData.assetReviewSummaries,
      linkGapIssues: sourceData.linkGapIssues,
    });

    yield* toCliResult(await db.accountingIssues.reconcileScope(snapshot), ExitCodes.GENERAL_ERROR);

    const scopeResult = yield* toCliResult(await db.accountingIssues.findScope(scopeKey), ExitCodes.GENERAL_ERROR);
    const scope = yield* toCliValue(
      scopeResult,
      new Error(`Accounting issue scope '${scopeKey}' not found after reconciliation`),
      ExitCodes.GENERAL_ERROR
    );
    const issueRecords = yield* toCliResult(
      await db.accountingIssues.listCurrentIssueSummaries(scopeKey),
      ExitCodes.GENERAL_ERROR
    );

    return {
      issueRecords,
      profileDisplayName: profile.displayName,
      scope,
    };
  });
}

function toIssuesOverviewState(data: IssuesOverviewData): IssuesStaticOverviewState {
  return {
    activeProfileKey: data.activeProfileKey,
    activeProfileSource: data.activeProfileSource,
    currentIssues: data.issueRecords.map((record) => record.issue),
    profileDisplayName: data.profileDisplayName,
    scope: data.scope,
    scopedLenses: [],
  };
}

function toIssuesDetailState(data: IssuesViewData): IssuesStaticDetailState {
  return {
    activeProfileKey: data.activeProfileKey,
    activeProfileSource: data.activeProfileSource,
    issue: data.issue,
    profileDisplayName: data.profileDisplayName,
  };
}
