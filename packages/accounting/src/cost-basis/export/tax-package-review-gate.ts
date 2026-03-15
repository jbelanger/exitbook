import type { TaxPackageValidatedScope } from './tax-package-scope-validator.js';
import type { TaxPackageIssue, TaxPackageReadinessResult, TaxPackageReviewGateInput } from './tax-package-types.js';

export function evaluateTaxPackageReadiness(
  input: TaxPackageReviewGateInput<TaxPackageValidatedScope>
): TaxPackageReadinessResult {
  const issues: TaxPackageIssue[] = [];
  const missingPricesCount = input.workflowResult.executionMeta.missingPricesCount;

  if (missingPricesCount > 0) {
    issues.push({
      code: 'MISSING_PRICE_DATA',
      severity: 'blocked',
      summary: 'Required transaction price data is missing.',
      details: `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${missingPricesCount} retained transactions are missing required price data.`,
    });
  }

  if ((input.metadata?.unresolvedAssetReviewCount ?? 0) > 0) {
    issues.push({
      code: 'UNRESOLVED_ASSET_REVIEW',
      severity: 'blocked',
      summary: 'Assets still require review before filing export.',
      details: `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${input.metadata?.unresolvedAssetReviewCount ?? 0} assets still require review resolution.`,
    });
  }

  if ((input.metadata?.unknownTransactionClassificationCount ?? 0) > 0) {
    issues.push({
      code: 'UNKNOWN_TRANSACTION_CLASSIFICATION',
      severity: 'blocked',
      summary: 'Some transactions still have unresolved tax classification.',
      details: `Tax package export for ${input.scope.config.jurisdiction} ${input.scope.config.taxYear} is blocked because ${input.metadata?.unknownTransactionClassificationCount ?? 0} transactions still require tax classification review.`,
    });
  }

  if ((input.metadata?.fxFallbackCount ?? 0) > 0) {
    issues.push({
      code: 'FX_FALLBACK_USED',
      severity: 'review',
      summary: 'Fallback FX handling was used.',
      details: `${input.metadata?.fxFallbackCount ?? 0} rows relied on fallback FX handling and should be reviewed before filing.`,
    });
  }

  if ((input.metadata?.incompleteTransferLinkCount ?? 0) > 0) {
    issues.push({
      code: 'INCOMPLETE_TRANSFER_LINKING',
      severity: 'review',
      summary: 'Some transfers were not fully linked.',
      details: `${input.metadata?.incompleteTransferLinkCount ?? 0} transfers require manual review because linking is incomplete.`,
    });
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
