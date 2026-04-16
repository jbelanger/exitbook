import {
  buildCostBasisIssueNoticeSummaries,
  type CostBasisContext,
  type CostBasisIssueNoticeSummary,
  type CostBasisWorkflowResult,
  type ValidatedCostBasisConfig,
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
  scopeConfig: ValidatedCostBasisConfig;
  scopeKey: string;
  snapshotId?: string | undefined;
  sourceContext: CostBasisContext;
}

export function buildCostBasisIssueNotices(
  params: BuildCostBasisIssueNoticesParams
): Result<CostBasisIssueNotice[], Error> {
  return resultTry(function* () {
    const summaries = yield* buildCostBasisIssueNoticeSummaries(params);
    return formatCostBasisIssueNotices(params.scopeConfig, summaries);
  }, 'Failed to derive cost basis issue notices');
}

export function formatCostBasisIssueNotices(
  scopeConfig: ValidatedCostBasisConfig,
  summaries: readonly CostBasisIssueNoticeSummary[]
): CostBasisIssueNotice[] {
  const reviewCommand = buildCostBasisIssuesReviewCommand(scopeConfig);

  return summaries.map((summary) => ({
    count: summary.count,
    kind: summary.kind,
    message: formatIssueNoticeMessage(summary.kind === 'blocking_issues' ? 'blocking' : 'warning', summary.count),
    reviewCommand,
    severity: summary.severity,
  }));
}

export function buildCostBasisIssuesReviewCommand(scopeConfig: ValidatedCostBasisConfig): string {
  return [
    'exitbook issues cost-basis',
    `--jurisdiction ${scopeConfig.jurisdiction}`,
    `--tax-year ${scopeConfig.taxYear}`,
    `--method ${scopeConfig.method}`,
    `--fiat-currency ${scopeConfig.currency}`,
    `--start-date ${scopeConfig.startDate.toISOString()}`,
    `--end-date ${scopeConfig.endDate.toISOString()}`,
  ].join(' ');
}

function formatIssueNoticeMessage(kind: 'blocking' | 'warning', count: number): string {
  const noun = count === 1 ? 'issue' : 'issues';
  const pronoun = count === 1 ? 'it' : 'them';

  if (kind === 'blocking') {
    return `${count} blocking ${noun} in this scope. Review ${pronoun} in issues.`;
  }

  return `${count} warning ${noun} in this scope. Review ${pronoun} in issues.`;
}
