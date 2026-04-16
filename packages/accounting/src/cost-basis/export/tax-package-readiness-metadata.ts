import type { AssetReviewSummary, Transaction } from '@exitbook/core';

import { collectBlockingAssetReviewSummaries } from '../../accounting-model/asset-review-preflight.js';
import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

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
  const readinessScope = deriveTaxPackageReadinessScope(params.context);
  const taxRelevantTransactions = getTransactionsById(params.context, readinessScope.transactionIds);
  const incompleteTransferLinkDetails = collectIncompleteTransferLinkDetails(params.context);
  const allocationUncertainDetails = collectTransactionIssueDetails<TaxPackageUncertainProceedsAllocationDetail>(
    taxRelevantTransactions,
    ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES
  );
  const unknownTransactionClassificationDetails =
    collectUnknownTransactionClassificationDetails(taxRelevantTransactions);

  return {
    allocationUncertainCount: allocationUncertainDetails.length,
    allocationUncertainDetails,
    fxFallbackCount: countFxFallbackRows(params.context),
    incompleteTransferLinkCount: incompleteTransferLinkDetails.length,
    incompleteTransferLinkDetails,
    unknownTransactionClassificationCount: unknownTransactionClassificationDetails.length,
    unknownTransactionClassificationDetails,
    unresolvedAssetReviewCount: countTaxRelevantAssetsRequiringReview(
      readinessScope.assetIds,
      params.assetReviewSummaries
    ),
  };
}

function getTransactionsById(context: TaxPackageBuildContext, transactionIds: ReadonlySet<number>): Transaction[] {
  return [...transactionIds]
    .map((transactionId) => context.sourceContext.transactionsById.get(transactionId))
    .filter((transaction): transaction is Transaction => transaction !== undefined);
}

interface TaxPackageReadinessScope {
  assetIds: ReadonlySet<string>;
  transactionIds: ReadonlySet<number>;
}

function deriveTaxPackageReadinessScope(context: TaxPackageBuildContext): TaxPackageReadinessScope {
  const { workflowResult } = context;

  if (workflowResult.kind === 'canada-workflow') {
    return deriveCanadaReadinessScope(workflowResult);
  }

  return deriveStandardReadinessScope(workflowResult);
}

function deriveCanadaReadinessScope(
  workflowResult: Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }>
): TaxPackageReadinessScope {
  const inputContext = workflowResult.inputContext;
  if (!inputContext) {
    throw new Error('Canada tax-package readiness requires inputContext');
  }

  const assetIds = new Set<string>();
  const transactionIds = new Set<number>();

  for (const inputEvent of inputContext.inputEvents) {
    assetIds.add(inputEvent.assetId);
    transactionIds.add(inputEvent.transactionId);

    if (inputEvent.kind === 'fee-adjustment') {
      assetIds.add(inputEvent.feeAssetId);
    }

    if (inputEvent.sourceTransactionId !== undefined) {
      transactionIds.add(inputEvent.sourceTransactionId);
    }
  }

  return { assetIds, transactionIds };
}

function deriveStandardReadinessScope(
  workflowResult: Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }>
): TaxPackageReadinessScope {
  const lotsById = new Map(workflowResult.lots.map((lot) => [lot.id, lot] as const));
  const assetIds = new Set<string>();
  const transactionIds = new Set<number>();

  for (const lot of workflowResult.lots) {
    assetIds.add(lot.assetId);
    transactionIds.add(lot.acquisitionTransactionId);
  }

  for (const disposal of workflowResult.disposals) {
    transactionIds.add(disposal.disposalTransactionId);

    const sourceLot = lotsById.get(disposal.lotId);
    if (!sourceLot) {
      throw new Error(`Missing source lot ${disposal.lotId} for readiness disposal scope`);
    }

    assetIds.add(sourceLot.assetId);
    transactionIds.add(sourceLot.acquisitionTransactionId);
  }

  for (const transfer of workflowResult.lotTransfers) {
    transactionIds.add(transfer.sourceTransactionId);
    transactionIds.add(transfer.targetTransactionId);

    const sourceLot = lotsById.get(transfer.sourceLotId);
    if (!sourceLot) {
      throw new Error(`Missing source lot ${transfer.sourceLotId} for readiness transfer scope`);
    }

    assetIds.add(sourceLot.assetId);
  }

  return { assetIds, transactionIds };
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

function countTaxRelevantAssetsRequiringReview(
  assetIds: ReadonlySet<string>,
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>
): number {
  return collectBlockingAssetReviewSummaries(assetIds, assetReviewSummaries).length;
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
        inputEventsById.get(transfer.sourceTransferEventId ?? '')?.provenanceKind === 'internal-transfer-carryover' ||
        inputEventsById.get(transfer.targetTransferEventId ?? '')?.provenanceKind === 'internal-transfer-carryover';
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
