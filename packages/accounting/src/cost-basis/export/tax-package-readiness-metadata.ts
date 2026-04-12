import type { AssetReviewSummary, Transaction } from '@exitbook/core';

import { collectBlockingAssetReviewSummaries } from '../standard/validation/asset-review-preflight.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import type {
  TaxPackageIncompleteTransferLinkDetail,
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
  const incompleteTransferLinkDetails = collectIncompleteTransferLinkDetails(params.context);
  const allocationUncertainDetails = collectTransactionIssueDetails<TaxPackageUncertainProceedsAllocationDetail>(
    retainedTransactions,
    ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES
  );
  const unknownTransactionClassificationDetails = collectUnknownTransactionClassificationDetails(retainedTransactions);

  return {
    allocationUncertainCount: allocationUncertainDetails.length,
    allocationUncertainDetails,
    fxFallbackCount: countFxFallbackRows(params.context),
    incompleteTransferLinkCount: incompleteTransferLinkDetails.length,
    incompleteTransferLinkDetails,
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
        diagnosticCode: matchingDiagnostic.code,
        diagnosticMessage: matchingDiagnostic.message,
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

function collectIncompleteTransferLinkDetails(
  context: TaxPackageBuildContext
): TaxPackageIncompleteTransferLinkDetail[] {
  if (context.workflowResult.kind === 'canada-workflow') {
    const inputEventsById = new Map(
      (context.workflowResult.inputContext?.inputEvents ?? []).map((event) => [event.eventId, event])
    );

    return context.workflowResult.taxReport.transfers.flatMap((transfer) => {
      const isCarryoverOnly =
        inputEventsById.get(transfer.sourceTransferEventId ?? '')?.provenanceKind === 'fee-only-carryover' ||
        inputEventsById.get(transfer.targetTransferEventId ?? '')?.provenanceKind === 'fee-only-carryover';
      const hasConfirmedLink =
        transfer.linkId !== undefined &&
        transfer.sourceTransactionId !== undefined &&
        transfer.targetTransactionId !== undefined;

      if (hasConfirmedLink || isCarryoverOnly) {
        return [];
      }

      const sourceTransaction =
        transfer.sourceTransactionId !== undefined
          ? context.sourceContext.transactionsById.get(transfer.sourceTransactionId)
          : undefined;
      const targetTransaction =
        transfer.targetTransactionId !== undefined
          ? context.sourceContext.transactionsById.get(transfer.targetTransactionId)
          : undefined;

      return [
        {
          assetSymbol: transfer.assetSymbol,
          rowId: transfer.id,
          sourcePlatformKey: sourceTransaction?.platformKey,
          sourceTransactionId: transfer.sourceTransactionId,
          targetPlatformKey: targetTransaction?.platformKey,
          targetTransactionId: transfer.targetTransactionId,
          transactionDatetime: transfer.transferredAt.toISOString(),
          transactionId: transfer.transactionId,
        },
      ];
    });
  }

  // Standard workflow carryovers are deterministic internal fee handling and are not user-actionable linking work.
  return [];
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
