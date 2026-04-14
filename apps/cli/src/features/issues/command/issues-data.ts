import { type ValidatedCostBasisConfig } from '@exitbook/accounting/cost-basis';
import {
  buildProfileAccountingIssueScopeSnapshot,
  materializeCostBasisAccountingIssueScopeSnapshot,
  type AccountingIssueDetailItem,
  type AccountingIssueScopeSummary,
  type AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import { buildCostBasisPorts, loadProfileAccountingIssueSourceData } from '@exitbook/data/accounting';
import { buildProfileProjectionScopeKey } from '@exitbook/data/projections';
import { err, resultDoAsync, type Result } from '@exitbook/foundation';

import { toCliResult, toCliValue, type CliFailure } from '../../../cli/command.js';
import { createCliFailure, ExitCodes } from '../../../cli/command.js';
import type { CliOutputFormat } from '../../../cli/options.js';
import { loadAccountingExclusionPolicy } from '../../../runtime/accounting-exclusion-policy.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  ensureAssetReviewReady,
  ensureLinksReady,
  ensureProcessedTransactionsReady,
} from '../../../runtime/projection-readiness.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { buildIssueSelector, resolveIssueSelector, getIssueSelectorErrorExitCode } from '../issue-selector.js';

interface IssueSummaryRecord {
  issueKey: string;
  issue: AccountingIssueSummaryItem;
}

interface MaterializedProfileIssuesData {
  issueRecords: IssueSummaryRecord[];
  profileDisplayName: string;
  profileId: number;
  scopedLenses: AccountingIssueScopeSummary[];
  scope: AccountingIssueScopeSummary;
}

export interface IssuesOverviewData extends MaterializedProfileIssuesData {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
}

export interface IssuesViewData {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  issue: AccountingIssueDetailItem;
  profileDisplayName: string;
}

export interface ResolvedCurrentIssueData extends IssuesViewData {
  issueKey: string;
  profileId: number;
  scopeKey: string;
}

export interface IssuesScopedCostBasisData {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  issueRecords: IssueSummaryRecord[];
  profileDisplayName: string;
  scope: AccountingIssueScopeSummary;
}

export async function loadIssuesOverviewData(
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

export async function loadIssueViewData(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  selector: string
): Promise<Result<IssuesViewData, CliFailure>> {
  return resultDoAsync(async function* () {
    const resolved = yield* await resolveCurrentIssueData(runtime, format, selector);

    return {
      activeProfileKey: resolved.activeProfileKey,
      activeProfileSource: resolved.activeProfileSource,
      issue: resolved.issue,
      profileDisplayName: resolved.profileDisplayName,
    };
  });
}

export async function resolveCurrentIssueData(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  selector: string
): Promise<Result<ResolvedCurrentIssueData, CliFailure>> {
  return resultDoAsync(async function* () {
    const overview = yield* await loadIssuesOverviewData(runtime, format);
    const db = await runtime.database();
    const scopedIssueRecords = yield* toCliResult(
      await db.accountingIssues.listCurrentIssueSummariesForProfile(overview.profileId),
      ExitCodes.GENERAL_ERROR
    );
    const resolution = resolveIssueSelector(
      scopedIssueRecords.map((record) => ({
        fullSelector: buildIssueSelector(record.scopeKey, record.issueKey),
        item: record,
      })),
      selector
    );
    if (resolution.isErr()) {
      return yield* err(createCliFailure(resolution.error, getIssueSelectorErrorExitCode(resolution.error)));
    }

    const detailResult = yield* toCliResult(
      await db.accountingIssues.findCurrentIssueDetail(resolution.value.item.scopeKey, resolution.value.item.issueKey),
      ExitCodes.GENERAL_ERROR
    );
    const detail = yield* toCliValue(
      detailResult,
      new Error(`Issue ref '${selector.trim().toLowerCase()}' not found`),
      ExitCodes.NOT_FOUND
    );

    return {
      activeProfileKey: overview.activeProfileKey,
      activeProfileSource: overview.activeProfileSource,
      issue: detail.issue,
      issueKey: detail.issueKey,
      profileDisplayName: overview.profileDisplayName,
      profileId: overview.profileId,
      scopeKey: resolution.value.item.scopeKey,
    };
  });
}

export async function loadScopedCostBasisIssuesData(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  params: ValidatedCostBasisConfig
): Promise<Result<IssuesScopedCostBasisData, CliFailure>> {
  return resultDoAsync(async function* () {
    const materialized = yield* await materializeScopedCostBasisIssues(runtime, format, params);

    return {
      activeProfileKey: runtime.activeProfileKey,
      activeProfileSource: runtime.activeProfileSource,
      ...materialized,
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

    yield* await ensureProfileIssueInputsReady(runtime, format, profile.id, profile.profileKey);

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
    const scopeSummaries = yield* toCliResult(
      await db.accountingIssues.listScopeSummaries(profile.id),
      ExitCodes.GENERAL_ERROR
    );

    return {
      issueRecords,
      profileDisplayName: profile.displayName,
      profileId: profile.id,
      scopedLenses: scopeSummaries.filter((summary) => summary.scopeKind === 'cost-basis'),
      scope,
    };
  });
}

async function materializeScopedCostBasisIssues(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  params: ValidatedCostBasisConfig
): Promise<
  Result<
    {
      issueRecords: IssueSummaryRecord[];
      profileDisplayName: string;
      scope: AccountingIssueScopeSummary;
    },
    CliFailure
  >
> {
  return resultDoAsync(async function* () {
    const db = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, db), ExitCodes.GENERAL_ERROR);

    yield* await ensureProfileIssueInputsReady(runtime, format, profile.id, profile.profileKey);

    const accountingExclusionPolicy = yield* toCliResult(
      await loadAccountingExclusionPolicy(runtime.dataDir, profile.profileKey),
      ExitCodes.GENERAL_ERROR
    );
    const contextReader = buildCostBasisPorts(db, profile.id);
    const assetReviewSummaries = yield* toCliResult(
      await readAssetReviewProjectionSummaries(db, profile.id),
      ExitCodes.GENERAL_ERROR
    );
    const priceRuntime = params.currency === 'USD' ? undefined : await runtime.openPriceProviderRuntime();
    const snapshot = yield* toCliResult(
      await materializeCostBasisAccountingIssueScopeSnapshot({
        accountingExclusionPolicy,
        assetReviewSummaries,
        config: params,
        contextReader,
        priceRuntime,
        profileId: profile.id,
      }),
      ExitCodes.GENERAL_ERROR
    );

    yield* toCliResult(await db.accountingIssues.reconcileScope(snapshot), ExitCodes.GENERAL_ERROR);

    const scopeResult = yield* toCliResult(
      await db.accountingIssues.findScope(snapshot.scope.scopeKey),
      ExitCodes.GENERAL_ERROR
    );
    const scope = yield* toCliValue(
      scopeResult,
      new Error(`Accounting issue scope '${snapshot.scope.scopeKey}' not found after reconciliation`),
      ExitCodes.GENERAL_ERROR
    );
    const issueRecords = yield* toCliResult(
      await db.accountingIssues.listCurrentIssueSummaries(snapshot.scope.scopeKey),
      ExitCodes.GENERAL_ERROR
    );

    return {
      issueRecords,
      profileDisplayName: profile.displayName,
      scope,
    };
  });
}

async function ensureProfileIssueInputsReady(
  runtime: CommandRuntime,
  format: CliOutputFormat,
  profileId: number,
  profileKey: string
): Promise<Result<void, CliFailure>> {
  return resultDoAsync(async function* () {
    yield* toCliResult(
      await ensureProcessedTransactionsReady(runtime, {
        format,
        profileId,
        profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );
    yield* toCliResult(
      await ensureAssetReviewReady(runtime, {
        profileId,
        profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );
    yield* toCliResult(
      await ensureLinksReady(runtime, {
        format,
        profileId,
        profileKey,
      }),
      ExitCodes.GENERAL_ERROR
    );
  });
}
