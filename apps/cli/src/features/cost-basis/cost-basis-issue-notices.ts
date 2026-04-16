import {
  buildTaxPackageBuildContext,
  deriveTaxPackageReadinessMetadata,
  evaluateTaxPackageReadiness,
  type CostBasisContext,
  type CostBasisWorkflowResult,
  type TaxPackageConfigScope,
} from '@exitbook/accounting/cost-basis';
import type { AssetReviewSummary } from '@exitbook/core';
import { resultTry, type Result } from '@exitbook/foundation';

export type CostBasisIssueNoticeKind = 'blocking_issues' | 'warning_issues';
export type CostBasisIssueNoticeSeverity = 'warning' | 'blocked';

export interface CostBasisIssueNotice {
  count: number;
  kind: CostBasisIssueNoticeKind;
  message: string;
  reviewCommand: string;
  severity: CostBasisIssueNoticeSeverity;
}

interface BuildCostBasisIssueNoticesParams {
  artifact: CostBasisWorkflowResult;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
  scopeConfig: TaxPackageConfigScope;
  scopeKey: string;
  snapshotId?: string | undefined;
  sourceContext: CostBasisContext;
}

export function buildCostBasisIssueNotices(
  params: BuildCostBasisIssueNoticesParams
): Result<CostBasisIssueNotice[], Error> {
  return resultTry(function* () {
    const context = yield* buildTaxPackageBuildContext({
      artifact: params.artifact,
      sourceContext: params.sourceContext,
      scopeKey: params.scopeKey,
      snapshotId: params.snapshotId,
    });

    const readiness = evaluateTaxPackageReadiness({
      workflowResult: params.artifact,
      scope: { config: params.scopeConfig },
      metadata: deriveTaxPackageReadinessMetadata({
        context,
        assetReviewSummaries: params.assetReviewSummaries,
      }),
    });

    const reviewCommand = buildScopedIssuesReviewCommand(params.scopeConfig);
    const notices: CostBasisIssueNotice[] = [];

    if (readiness.blockingIssues.length > 0) {
      notices.push({
        count: readiness.blockingIssues.length,
        kind: 'blocking_issues',
        message: formatIssueNoticeMessage('blocking', readiness.blockingIssues.length),
        reviewCommand,
        severity: 'blocked',
      });
    }

    if (readiness.warnings.length > 0) {
      notices.push({
        count: readiness.warnings.length,
        kind: 'warning_issues',
        message: formatIssueNoticeMessage('warning', readiness.warnings.length),
        reviewCommand,
        severity: 'warning',
      });
    }

    return notices;
  }, 'Failed to derive cost basis issue notices');
}

function buildScopedIssuesReviewCommand(scopeConfig: TaxPackageConfigScope): string {
  return `exitbook issues cost-basis --jurisdiction ${scopeConfig.jurisdiction} --tax-year ${scopeConfig.taxYear} --method ${scopeConfig.method}`;
}

function formatIssueNoticeMessage(kind: 'blocking' | 'warning', count: number): string {
  const noun = count === 1 ? 'issue' : 'issues';
  const pronoun = count === 1 ? 'it' : 'them';

  if (kind === 'blocking') {
    return `${count} blocking ${noun} in this scope. Review ${pronoun} in issues.`;
  }

  return `${count} warning ${noun} in this scope. Review ${pronoun} in issues.`;
}
