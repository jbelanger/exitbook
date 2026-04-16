import type { AssetReviewSummary } from '@exitbook/core';
import { resultTry, type Result } from '@exitbook/foundation';

import type { CostBasisContext } from '../../ports/cost-basis-persistence.js';
import type { ValidatedCostBasisConfig } from '../workflow/cost-basis-input.js';
import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import { buildTaxPackageBuildContext } from './tax-package-context-builder.js';
import { deriveTaxPackageReadinessMetadata } from './tax-package-readiness-metadata.js';
import { evaluateTaxPackageReadiness } from './tax-package-review-gate.js';

export type CostBasisIssueNoticeSummaryKind = 'blocking_issues' | 'warning_issues';
export type CostBasisIssueNoticeSummarySeverity = 'warning' | 'blocked';

export interface CostBasisIssueNoticeSummary {
  count: number;
  kind: CostBasisIssueNoticeSummaryKind;
  severity: CostBasisIssueNoticeSummarySeverity;
}

interface BuildCostBasisIssueNoticeSummariesParams {
  artifact: CostBasisWorkflowResult;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
  scopeConfig: ValidatedCostBasisConfig;
  scopeKey: string;
  snapshotId?: string | undefined;
  sourceContext: CostBasisContext;
}

export function buildCostBasisIssueNoticeSummaries(
  params: BuildCostBasisIssueNoticeSummariesParams
): Result<CostBasisIssueNoticeSummary[], Error> {
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

    const summaries: CostBasisIssueNoticeSummary[] = [];

    if (readiness.blockingIssues.length > 0) {
      summaries.push({
        count: readiness.blockingIssues.length,
        kind: 'blocking_issues',
        severity: 'blocked',
      });
    }

    if (readiness.warnings.length > 0) {
      summaries.push({
        count: readiness.warnings.length,
        kind: 'warning_issues',
        severity: 'warning',
      });
    }

    return summaries;
  }, 'Failed to derive cost basis issue notice summaries');
}
