import type { AssetReviewSummary, Transaction } from '@exitbook/core';
import { isFiat, parseCurrency } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import {
  collectTransactionReadinessIssues,
  deriveOperationLabel,
  type DerivedOperationLabel,
  type TransactionAnnotation,
} from '@exitbook/transaction-interpretation';

import { collectBlockingAssetReviewSummaries } from '../../accounting-model/asset-review-preflight.js';
import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import type {
  TaxPackageIncompleteTransferLinkDetail,
  TaxPackageMissingPriceDetail,
  TaxPackageMissingPriceItemDetail,
  TaxPackageReadinessMetadata,
  TaxPackageUncertainProceedsAllocationDetail,
  TaxPackageUnknownTransactionClassificationDetail,
} from './tax-package-types.js';

const logger = getLogger('cost-basis.export.tax-package-readiness-metadata');

export function deriveTaxPackageReadinessMetadata(params: {
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  context: TaxPackageBuildContext;
}): TaxPackageReadinessMetadata {
  const readinessScope = deriveTaxPackageReadinessScope(params.context);
  const taxRelevantTransactions = getTransactionsById(params.context, readinessScope.transactionIds);
  const incompleteTransferLinkDetails = collectIncompleteTransferLinkDetails(params.context);
  const allocationUncertainDetails = collectTransactionIssueDetails<TaxPackageUncertainProceedsAllocationDetail>(
    params.context,
    taxRelevantTransactions,
    'uncertain_proceeds_allocation'
  );
  const unknownTransactionClassificationDetails = collectUnknownTransactionClassificationDetails(
    params.context,
    taxRelevantTransactions
  );

  return {
    allocationUncertainCount: allocationUncertainDetails.length,
    allocationUncertainDetails,
    fxFallbackCount: countFxFallbackRows(params.context),
    incompleteTransferLinkCount: incompleteTransferLinkDetails.length,
    incompleteTransferLinkDetails,
    missingPriceDetails: collectMissingPriceDetails(params.context),
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
  context: TaxPackageBuildContext,
  transactions: readonly Transaction[]
): TaxPackageUnknownTransactionClassificationDetail[] {
  return transactions.flatMap((transaction) => {
    const matchingIssue = collectTransactionReadinessIssues(
      transaction,
      getAssertedTransactionAnnotations(context, transaction.id)
    ).find((issue) => issue.code === 'unknown_classification');
    if (!matchingIssue) {
      return [];
    }

    const derivedOperation = deriveTaxReadinessOperation(context, transaction);

    return [
      {
        diagnosticCode: matchingIssue.diagnosticCode,
        diagnosticMessage: matchingIssue.diagnosticMessage,
        operationGroup: derivedOperation.group,
        operationLabel: derivedOperation.label,
        reference: transaction.txFingerprint,
        platformKey: transaction.platformKey,
        transactionDatetime: transaction.datetime,
        transactionId: transaction.id,
      },
    ];
  });
}

function collectTransactionIssueDetails<TDetail extends TaxPackageUnknownTransactionClassificationDetail>(
  context: TaxPackageBuildContext,
  transactions: readonly Transaction[],
  issueCode: 'uncertain_proceeds_allocation'
): TDetail[] {
  return transactions.flatMap((transaction) => {
    const matchingIssue = collectTransactionReadinessIssues(
      transaction,
      getAssertedTransactionAnnotations(context, transaction.id)
    ).find((issue) => issue.code === issueCode);
    if (!matchingIssue) {
      return [];
    }

    const derivedOperation = deriveTaxReadinessOperation(context, transaction);

    return [
      {
        diagnosticCode: matchingIssue.diagnosticCode,
        diagnosticMessage: matchingIssue.diagnosticMessage,
        operationGroup: derivedOperation.group,
        operationLabel: derivedOperation.label,
        reference: transaction.txFingerprint,
        platformKey: transaction.platformKey,
        transactionDatetime: transaction.datetime,
        transactionId: transaction.id,
      } as TDetail,
    ];
  });
}

function deriveTaxReadinessOperation(context: TaxPackageBuildContext, transaction: Transaction): DerivedOperationLabel {
  return deriveOperationLabel(transaction, getAssertedTransactionAnnotations(context, transaction.id));
}

function getAssertedTransactionAnnotations(
  context: TaxPackageBuildContext,
  transactionId: number
): readonly TransactionAnnotation[] {
  return (context.sourceContext.transactionAnnotationsByTransactionId.get(transactionId) ?? []).filter(
    (annotation) => annotation.tier === 'asserted'
  );
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

function collectMissingPriceDetails(context: TaxPackageBuildContext): TaxPackageMissingPriceDetail[] {
  return context.workflowResult.executionMeta.missingPriceTransactionIds.map((transactionId) => {
    const transaction = context.sourceContext.transactionsById.get(transactionId);
    if (!transaction) {
      throw new Error(`Missing price readiness detail requires source transaction ${transactionId}`);
    }

    const missingItems = collectTransactionMissingPriceItems(transaction);
    if (missingItems.length === 0) {
      throw new Error(
        `Missing price readiness detail could not find any missing priced items on transaction ${transaction.txFingerprint}`
      );
    }

    return {
      missingItems,
      platformKey: transaction.platformKey,
      reference: transaction.txFingerprint,
      transactionDatetime: transaction.datetime,
      transactionId: transaction.id,
    };
  });
}

function collectTransactionMissingPriceItems(transaction: Transaction): TaxPackageMissingPriceItemDetail[] {
  return [
    ...collectMissingPriceItemDetails('inflow', transaction.movements.inflows ?? []),
    ...collectMissingPriceItemDetails('outflow', transaction.movements.outflows ?? []),
    ...collectMissingPriceItemDetails('fee', transaction.fees ?? []),
  ];
}

function collectMissingPriceItemDetails(
  kind: TaxPackageMissingPriceItemDetail['kind'],
  movements: readonly { assetSymbol: string; priceAtTxTime?: unknown }[]
): TaxPackageMissingPriceItemDetail[] {
  return movements.flatMap((movement) => {
    if (movement.priceAtTxTime) {
      return [];
    }

    if (isFiatAssetSymbol(movement.assetSymbol)) {
      return [];
    }

    return [
      {
        assetSymbol: movement.assetSymbol,
        kind,
      },
    ];
  });
}

function isFiatAssetSymbol(assetSymbol: string): boolean {
  const parsedCurrency = parseCurrency(assetSymbol.trim());
  if (parsedCurrency.isOk()) {
    return isFiat(parsedCurrency.value);
  }

  logger.warn(
    { error: parsedCurrency.error, assetSymbol },
    'Unknown asset symbol while deriving missing-price issue detail, treating it as price-requiring'
  );
  return false;
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
