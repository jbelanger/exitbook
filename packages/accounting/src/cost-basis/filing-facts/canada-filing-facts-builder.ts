import { ok, type Result, wrapError } from '@exitbook/core';

import type { CanadaCostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import {
  buildCostBasisFilingAssetSummaries,
  buildCostBasisFilingFactsSummary,
} from './filing-facts-summary-builder.js';
import type {
  CanadaCostBasisAcquisitionFilingFact,
  CanadaCostBasisDispositionFilingFact,
  CanadaCostBasisFilingFacts,
  CanadaCostBasisTransferFilingFact,
  CanadaSuperficialLossAdjustmentFilingFact,
} from './filing-facts-types.js';

export interface BuildCanadaCostBasisFilingFactsInput {
  artifact: CanadaCostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}

export function buildCanadaCostBasisFilingFacts(
  input: BuildCanadaCostBasisFilingFactsInput
): Result<CanadaCostBasisFilingFacts, Error> {
  try {
    const acquisitions: CanadaCostBasisAcquisitionFilingFact[] = input.artifact.taxReport.acquisitions.map(
      (acquisition) => ({
        kind: 'canada-acquisition',
        id: acquisition.id,
        acquisitionEventId: acquisition.acquisitionEventId,
        taxPropertyKey: acquisition.taxPropertyKey,
        assetSymbol: acquisition.assetSymbol,
        acquiredAt: acquisition.acquiredAt,
        quantity: acquisition.quantityAcquired,
        remainingQuantity: acquisition.remainingQuantity,
        totalCostBasis: acquisition.totalCostCad,
        remainingAllocatedCostBasis: acquisition.remainingAllocatedAcbCad,
        costBasisPerUnit: acquisition.costBasisPerUnitCad,
        transactionId: acquisition.transactionId,
      })
    );

    const dispositions: CanadaCostBasisDispositionFilingFact[] = input.artifact.taxReport.dispositions.map(
      (disposition) => ({
        kind: 'canada-disposition',
        id: disposition.id,
        dispositionEventId: disposition.dispositionEventId,
        taxPropertyKey: disposition.taxPropertyKey,
        assetSymbol: disposition.assetSymbol,
        disposedAt: disposition.disposedAt,
        quantity: disposition.quantityDisposed,
        proceedsPerUnit: disposition.quantityDisposed.isZero()
          ? disposition.proceedsCad
          : disposition.proceedsCad.dividedBy(disposition.quantityDisposed),
        totalProceeds: disposition.proceedsCad,
        totalCostBasis: disposition.costBasisCad,
        costBasisPerUnit: disposition.acbPerUnitCad,
        gainLoss: disposition.gainLossCad,
        taxableGainLoss: disposition.taxableGainLossCad,
        deniedLossAmount: disposition.deniedLossCad,
        transactionId: disposition.transactionId,
      })
    );

    const transfers: CanadaCostBasisTransferFilingFact[] = input.artifact.taxReport.transfers.map((transfer) => ({
      kind: 'canada-transfer',
      id: transfer.id,
      direction: transfer.direction,
      taxPropertyKey: transfer.taxPropertyKey,
      assetSymbol: transfer.assetSymbol,
      transferredAt: transfer.transferredAt,
      quantity: transfer.quantity,
      totalCostBasis: transfer.carriedAcbCad,
      costBasisPerUnit: transfer.carriedAcbPerUnitCad,
      transactionId: transfer.transactionId,
      sourceTransferEventId: transfer.sourceTransferEventId,
      targetTransferEventId: transfer.targetTransferEventId,
      sourceTransactionId: transfer.sourceTransactionId,
      targetTransactionId: transfer.targetTransactionId,
      linkedConfirmedLinkId: transfer.linkId,
      feeAdjustment: transfer.feeAdjustmentCad,
    }));

    const superficialLossAdjustments: CanadaSuperficialLossAdjustmentFilingFact[] =
      input.artifact.taxReport.superficialLossAdjustments.map((adjustment) => ({
        kind: 'canada-superficial-loss-adjustment',
        id: adjustment.id,
        taxPropertyKey: adjustment.taxPropertyKey,
        assetSymbol: adjustment.assetSymbol,
        adjustedAt: adjustment.adjustedAt,
        deniedLossAmount: adjustment.deniedLossCad,
        deniedQuantity: adjustment.deniedQuantity,
        relatedDispositionId: adjustment.relatedDispositionId,
        substitutedPropertyAcquisitionId: adjustment.substitutedPropertyAcquisitionId,
      }));

    const assetSummaries = buildCostBasisFilingAssetSummaries({
      acquisitions,
      dispositions,
      transfers,
    });
    const summary = buildCostBasisFilingFactsSummary({
      acquisitions,
      dispositions,
      transfers,
      assetSummaries,
    });

    return ok({
      kind: 'canada',
      calculationId: input.artifact.calculation.id,
      jurisdiction: input.artifact.calculation.jurisdiction,
      method: input.artifact.calculation.method,
      taxYear: input.artifact.calculation.taxYear,
      taxCurrency: input.artifact.taxReport.taxCurrency,
      scopeKey: input.scopeKey,
      snapshotId: input.snapshotId,
      summary,
      assetSummaries,
      acquisitions,
      dispositions,
      transfers,
      superficialLossAdjustments,
    });
  } catch (error) {
    return wrapError(error, 'Failed to build Canada filing facts');
  }
}
