import type { AssetReviewSummary, UniversalTransactionData } from '@exitbook/core';

import { collectBlockingAssetReviewSummaries } from '../standard/validation/asset-review-preflight.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import type { TaxPackageReadinessMetadata } from './tax-package-types.js';

const UNKNOWN_CLASSIFICATION_NOTE_TYPES = new Set(['classification_uncertain', 'classification_failed']);

export function deriveTaxPackageReadinessMetadata(params: {
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  context: TaxPackageBuildContext;
}): TaxPackageReadinessMetadata {
  const retainedTransactions = getRetainedTransactions(params.context);

  return {
    fxFallbackCount: countFxFallbackRows(params.context),
    incompleteTransferLinkCount: countIncompleteTransferLinks(params.context),
    unknownTransactionClassificationCount: countUnknownTransactionClassificationTransactions(retainedTransactions),
    unresolvedAssetReviewCount: countScopedAssetsRequiringReview(retainedTransactions, params.assetReviewSummaries),
  };
}

function getRetainedTransactions(context: TaxPackageBuildContext): UniversalTransactionData[] {
  return context.workflowResult.executionMeta.retainedTransactionIds
    .map((transactionId) => context.sourceContext.transactionsById.get(transactionId))
    .filter((transaction): transaction is UniversalTransactionData => transaction !== undefined);
}

function countUnknownTransactionClassificationTransactions(transactions: readonly UniversalTransactionData[]): number {
  return transactions.filter(
    (transaction) => transaction.notes?.some((note) => UNKNOWN_CLASSIFICATION_NOTE_TYPES.has(note.type)) ?? false
  ).length;
}

function countScopedAssetsRequiringReview(
  transactions: readonly UniversalTransactionData[],
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>
): number {
  const assetsInScope = new Set<string>();
  for (const transaction of transactions) {
    for (const inflow of transaction.movements.inflows ?? []) {
      assetsInScope.add(inflow.assetId);
    }
    for (const outflow of transaction.movements.outflows ?? []) {
      assetsInScope.add(outflow.assetId);
    }
    for (const fee of transaction.fees ?? []) {
      assetsInScope.add(fee.assetId);
    }
  }

  return collectBlockingAssetReviewSummaries(assetsInScope, assetReviewSummaries).length;
}

function countIncompleteTransferLinks(context: TaxPackageBuildContext): number {
  if (context.workflowResult.kind === 'canada-workflow') {
    return context.workflowResult.taxReport.transfers.filter(
      (transfer) =>
        transfer.linkId === undefined ||
        transfer.sourceTransactionId === undefined ||
        transfer.targetTransactionId === undefined
    ).length;
  }

  return 0;
}

function countFxFallbackRows(context: TaxPackageBuildContext): number {
  if (context.workflowResult.kind === 'standard-workflow' && context.workflowResult.report) {
    const { report } = context.workflowResult;
    return [
      ...report.disposals.filter((disposal) => disposal.fxConversion.fxSource === 'fallback'),
      ...report.lots.filter((lot) => lot.fxUnavailable === true || lot.fxConversion.fxSource === 'fallback'),
      ...report.lotTransfers.filter(
        (transfer) => transfer.fxUnavailable === true || transfer.fxConversion.fxSource === 'fallback'
      ),
    ].length;
  }

  return 0;
}
