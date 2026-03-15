import { getDefaultRecommendedAction } from './tax-package-issue-recommendations.js';
import type { TaxPackageValidatedScope } from './tax-package-scope-validator.js';
import type {
  TaxPackageIssue,
  TaxPackageReadinessResult,
  TaxPackageReviewGateInput,
  TaxPackageUnknownTransactionClassificationDetail,
} from './tax-package-types.js';

export function evaluateTaxPackageReadiness(
  input: TaxPackageReviewGateInput<TaxPackageValidatedScope>
): TaxPackageReadinessResult {
  const issues: TaxPackageIssue[] = [];
  const missingPricesCount = input.workflowResult.executionMeta.missingPricesCount;

  if (missingPricesCount > 0) {
    issues.push(
      buildReadinessIssue(
        'MISSING_PRICE_DATA',
        'blocked',
        'Required transaction price data is missing.',
        `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${missingPricesCount} retained transactions are missing required price data.`
      )
    );
  }

  if ((input.metadata?.unresolvedAssetReviewCount ?? 0) > 0) {
    issues.push(
      buildReadinessIssue(
        'UNRESOLVED_ASSET_REVIEW',
        'blocked',
        'Assets still require review before filing export.',
        `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${input.metadata?.unresolvedAssetReviewCount ?? 0} assets still require review resolution.`
      )
    );
  }

  if ((input.metadata?.unknownTransactionClassificationCount ?? 0) > 0) {
    const classificationDetails = input.metadata?.unknownTransactionClassificationDetails ?? [];
    if (classificationDetails.length > 0) {
      for (const detail of classificationDetails) {
        issues.push(
          buildReadinessIssue(
            'UNKNOWN_TRANSACTION_CLASSIFICATION',
            'blocked',
            'A retained transaction still has unresolved operation classification.',
            buildUnknownTransactionClassificationDetail(detail),
            {
              affectedArtifact: 'source transaction',
              affectedRowRef: detail.reference,
            }
          )
        );
      }
    } else {
      issues.push(
        buildReadinessIssue(
          'UNKNOWN_TRANSACTION_CLASSIFICATION',
          'blocked',
          'Some retained transactions still have unresolved operation classification.',
          `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${input.metadata?.unknownTransactionClassificationCount ?? 0} retained transactions still require operation classification review.`
        )
      );
    }
  }

  if ((input.metadata?.fxFallbackCount ?? 0) > 0) {
    issues.push(
      buildReadinessIssue(
        'FX_FALLBACK_USED',
        'review',
        'Fallback FX handling was used.',
        `${input.metadata?.fxFallbackCount ?? 0} rows relied on fallback FX handling and should be reviewed before filing.`
      )
    );
  }

  if ((input.metadata?.incompleteTransferLinkCount ?? 0) > 0) {
    issues.push(
      buildReadinessIssue(
        'INCOMPLETE_TRANSFER_LINKING',
        'review',
        'Some transfers were not fully linked.',
        `${input.metadata?.incompleteTransferLinkCount ?? 0} transfers require manual review because linking is incomplete.`
      )
    );
  }

  const blockingIssues = issues.filter((issue) => issue.severity === 'blocked');
  const reviewItems = issues.filter((issue) => issue.severity === 'review');

  return {
    status: blockingIssues.length > 0 ? 'blocked' : reviewItems.length > 0 ? 'review_required' : 'ready',
    issues,
    reviewItems,
    blockingIssues,
  };
}

function buildReadinessIssue(
  code: TaxPackageIssue['code'],
  severity: TaxPackageIssue['severity'],
  summary: string,
  details: string,
  metadata?: Pick<TaxPackageIssue, 'affectedArtifact' | 'affectedRowRef'>
): TaxPackageIssue {
  return {
    code,
    severity,
    summary,
    details,
    ...metadata,
    recommendedAction: getDefaultRecommendedAction(code),
  };
}

function buildUnknownTransactionClassificationDetail(detail: TaxPackageUnknownTransactionClassificationDetail): string {
  const operationLabel =
    detail.operationCategory !== undefined && detail.operationType !== undefined
      ? ` It is currently materialized as ${detail.operationCategory}/${detail.operationType}.`
      : '';

  return `Retained transaction ${detail.sourceName} ${detail.reference} at ${detail.transactionDatetime} could not be confidently classified into an accounting operation.${operationLabel} Import note (${detail.noteType}): ${detail.noteMessage}`;
}
