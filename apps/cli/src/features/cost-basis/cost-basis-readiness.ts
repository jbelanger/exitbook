import {
  buildTaxPackageBuildContext,
  deriveTaxPackageReadinessMetadata,
  type CostBasisContext,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting/cost-basis';
import type { AssetReviewSummary } from '@exitbook/core';
import { resultTry, type Result } from '@exitbook/foundation';

export type CostBasisReadinessWarningCode = 'INCOMPLETE_TRANSFER_LINKING' | 'UNRESOLVED_ASSET_REVIEW';
export type CostBasisReadinessWarningSeverity = 'warning' | 'blocked';

export interface CostBasisReadinessWarning {
  code: CostBasisReadinessWarningCode;
  count: number;
  message: string;
  severity: CostBasisReadinessWarningSeverity;
}

interface BuildCostBasisReadinessWarningsParams {
  artifact: CostBasisWorkflowResult;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
  scopeKey: string;
  snapshotId?: string | undefined;
  sourceContext: CostBasisContext;
}

export function buildCostBasisReadinessWarnings(
  params: BuildCostBasisReadinessWarningsParams
): Result<CostBasisReadinessWarning[], Error> {
  return resultTry(function* () {
    const context = yield* buildTaxPackageBuildContext({
      artifact: params.artifact,
      sourceContext: params.sourceContext,
      scopeKey: params.scopeKey,
      snapshotId: params.snapshotId,
    });

    const metadata = deriveTaxPackageReadinessMetadata({
      context,
      assetReviewSummaries: params.assetReviewSummaries,
    });
    const unresolvedAssetReviewCount = metadata.unresolvedAssetReviewCount ?? 0;
    const incompleteTransferLinkCount = metadata.incompleteTransferLinkCount ?? 0;

    const warnings: CostBasisReadinessWarning[] = [];

    if (unresolvedAssetReviewCount > 0) {
      warnings.push({
        code: 'UNRESOLVED_ASSET_REVIEW',
        count: unresolvedAssetReviewCount,
        message: formatAssetReviewWarning(unresolvedAssetReviewCount),
        severity: 'blocked',
      });
    }

    if (incompleteTransferLinkCount > 0) {
      warnings.push({
        code: 'INCOMPLETE_TRANSFER_LINKING',
        count: incompleteTransferLinkCount,
        message: formatIncompleteTransferWarning(incompleteTransferLinkCount),
        severity: 'warning',
      });
    }

    return warnings;
  }, 'Failed to derive cost basis readiness warnings');
}

function formatAssetReviewWarning(count: number): string {
  return `${count} ${count === 1 ? 'asset still requires' : 'assets still require'} review before filing export.`;
}

function formatIncompleteTransferWarning(count: number): string {
  return `${count} ${count === 1 ? 'transfer requires' : 'transfers require'} manual review because linking is incomplete.`;
}
