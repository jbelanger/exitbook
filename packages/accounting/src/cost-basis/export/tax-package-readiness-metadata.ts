import type { AssetReviewSummary, Transaction } from '@exitbook/core';

import { collectBlockingAssetReviewSummaries } from '../standard/validation/asset-review-preflight.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import type {
  TaxPackageReadinessMetadata,
  TaxPackageUncertainProceedsAllocationDetail,
  TaxPackageUnknownTransactionClassificationDetail,
} from './tax-package-types.js';

const ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES = new Set(['allocation_uncertain']);
const UNKNOWN_CLASSIFICATION_DIAGNOSTIC_CODES = new Set(['classification_uncertain', 'classification_failed']);

export function deriveTaxPackageReadinessMetadata(params: {
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  context: TaxPackageBuildContext;
}): TaxPackageReadinessMetadata {
  const retainedTransactions = getRetainedTransactions(params.context);
  const allocationUncertainDetails = collectTransactionIssueDetails<TaxPackageUncertainProceedsAllocationDetail>(
    retainedTransactions,
    ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES
  );
  const unknownTransactionClassificationDetails = collectUnknownTransactionClassificationDetails(retainedTransactions);

  return {
    allocationUncertainCount: allocationUncertainDetails.length,
    allocationUncertainDetails,
    fxFallbackCount: countFxFallbackRows(params.context),
    incompleteTransferLinkCount: countIncompleteTransferLinks(params.context),
    unknownTransactionClassificationCount: unknownTransactionClassificationDetails.length,
    unknownTransactionClassificationDetails,
    unresolvedAssetReviewCount: countScopedAssetsRequiringReview(retainedTransactions, params.assetReviewSummaries),
  };
}

function getRetainedTransactions(context: TaxPackageBuildContext): Transaction[] {
  return context.workflowResult.executionMeta.retainedTransactionIds
    .map((transactionId) => context.sourceContext.transactionsById.get(transactionId))
    .filter((transaction): transaction is Transaction => transaction !== undefined);
}

function collectUnknownTransactionClassificationDetails(
  transactions: readonly Transaction[]
): TaxPackageUnknownTransactionClassificationDetail[] {
  return collectTransactionIssueDetails<TaxPackageUnknownTransactionClassificationDetail>(
    transactions,
    UNKNOWN_CLASSIFICATION_DIAGNOSTIC_CODES
  );
}

function collectTransactionIssueDetails<TDetail extends TaxPackageUnknownTransactionClassificationDetail>(
  transactions: readonly Transaction[],
  diagnosticCodes: ReadonlySet<string>
): TDetail[] {
  return transactions.flatMap((transaction) => {
    const matchingDiagnostic = transaction.diagnostics?.find((diagnostic) => diagnosticCodes.has(diagnostic.code));
    if (!matchingDiagnostic) {
      return [];
    }

    return [
      {
        noteMessage: matchingDiagnostic.message,
        noteType: matchingDiagnostic.code,
        operationCategory: transaction.operation.category,
        operationType: transaction.operation.type,
        reference: transaction.txFingerprint,
        platformKey: transaction.platformKey,
        transactionDatetime: transaction.datetime,
        transactionId: transaction.id,
      } as TDetail,
    ];
  });
}

function countScopedAssetsRequiringReview(
  transactions: readonly Transaction[],
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

  return context.workflowResult.lotTransfers.filter((transfer) => transfer.provenance.kind !== 'confirmed-link').length;
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
