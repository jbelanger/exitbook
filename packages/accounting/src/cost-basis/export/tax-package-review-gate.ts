import { getDefaultRecommendedAction } from './tax-package-issue-recommendations.js';
import {
  formatIncompleteTransferLinkingIssueSummary,
  formatIncompleteTransferLinkingNotice,
  formatUnresolvedAssetReviewIssueDetails,
  formatUnresolvedAssetReviewIssueSummary,
} from './tax-package-readiness-messages.js';
import type { TaxPackageValidatedScope } from './tax-package-scope-validator.js';
import type {
  TaxPackageIssue,
  TaxPackageReadinessResult,
  TaxPackageReviewGateInput,
  TaxPackageUncertainProceedsAllocationDetail,
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
        formatUnresolvedAssetReviewIssueSummary(),
        formatUnresolvedAssetReviewIssueDetails({
          count: input.metadata?.unresolvedAssetReviewCount ?? 0,
          jurisdiction: input.scope.config.jurisdiction,
          taxYear: input.scope.config.taxYear,
        })
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
            'A tax-relevant transaction still has unresolved operation classification.',
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
          'Some tax-relevant transactions still have unresolved operation classification.',
          `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${input.metadata?.unknownTransactionClassificationCount ?? 0} tax-relevant transactions still require operation classification review.`
        )
      );
    }
  }

  if ((input.metadata?.fxFallbackCount ?? 0) > 0) {
    issues.push(
      buildReadinessIssue(
        'FX_FALLBACK_USED',
        'warning',
        'Fallback FX handling was used.',
        `${input.metadata?.fxFallbackCount ?? 0} rows relied on fallback FX handling and should be reviewed before filing.`
      )
    );
  }

  if ((input.metadata?.incompleteTransferLinkCount ?? 0) > 0) {
    issues.push(
      buildReadinessIssue(
        'INCOMPLETE_TRANSFER_LINKING',
        'warning',
        formatIncompleteTransferLinkingIssueSummary(),
        formatIncompleteTransferLinkingNotice(input.metadata?.incompleteTransferLinkCount ?? 0)
      )
    );
  }

  if ((input.metadata?.allocationUncertainCount ?? 0) > 0) {
    const allocationDetails = input.metadata?.allocationUncertainDetails ?? [];
    if (allocationDetails.length > 0) {
      for (const detail of allocationDetails) {
        issues.push(
          buildReadinessIssue(
            'UNCERTAIN_PROCEEDS_ALLOCATION',
            'warning',
            'A tax-relevant transaction has uncertain proceeds allocation across disposed assets.',
            buildUncertainProceedsAllocationDetail(detail),
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
          'UNCERTAIN_PROCEEDS_ALLOCATION',
          'warning',
          'Some tax-relevant transactions have uncertain proceeds allocation across disposed assets.',
          `${input.metadata?.allocationUncertainCount ?? 0} tax-relevant transactions could not be assigned an exact per-asset proceeds split from provider data.`
        )
      );
    }
  }

  const blockingIssues = issues.filter((issue) => issue.severity === 'blocked');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    status: blockingIssues.length > 0 ? 'blocked' : 'ready',
    issues,
    warnings,
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

  return `Tax-relevant transaction ${detail.platformKey} ${detail.reference} at ${detail.transactionDatetime} could not be confidently classified into an accounting operation.${operationLabel} Diagnostic (${detail.diagnosticCode}): ${detail.diagnosticMessage}`;
}

function buildUncertainProceedsAllocationDetail(detail: TaxPackageUncertainProceedsAllocationDetail): string {
  const operationLabel =
    detail.operationCategory !== undefined && detail.operationType !== undefined
      ? ` It is currently materialized as ${detail.operationCategory}/${detail.operationType}.`
      : '';

  return `Tax-relevant transaction ${detail.platformKey} ${detail.reference} at ${detail.transactionDatetime} has provider hints for its economic classification, but the provider data does not specify an exact per-asset proceeds allocation.${operationLabel} Diagnostic (${detail.diagnosticCode}): ${detail.diagnosticMessage}`;
}
