import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';

import { fromStoredCanadaDebug } from '../jurisdictions/canada/artifacts/canada-artifact-codec.js';
import type {
  CostBasisReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  FxConversionMetadata,
} from '../model/report-types.js';
import type { AcquisitionLot, CostBasisCalculation, LotDisposal, LotTransfer } from '../model/schemas.js';
import type { CostBasisWorkflowResult } from '../workflow/cost-basis-workflow.js';

import type {
  StoredAcquisitionLot,
  StoredCostBasisCalculation,
  StoredCostBasisDebug,
  StoredCostBasisReport,
  StoredFxConversion,
  StoredLotDisposal,
  StoredLotTransfer,
  StoredStandardArtifact,
  StoredStandardDebug,
} from './artifact-storage-schemas.js';
import type { CostBasisArtifactDebugPayload } from './artifact-storage-shared.js';

export function toStoredStandardArtifact(
  result: Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }>,
  calculationWindow: { endDate: Date; startDate: Date }
): StoredStandardArtifact {
  return {
    kind: 'standard-workflow',
    calculation: toStoredCostBasisCalculation(result.summary.calculation, calculationWindow),
    lotsCreated: result.summary.lotsCreated,
    disposalsProcessed: result.summary.disposalsProcessed,
    totalCapitalGainLoss: result.summary.totalCapitalGainLoss.toFixed(),
    totalTaxableGainLoss: result.summary.totalTaxableGainLoss.toFixed(),
    assetsProcessed: result.summary.assetsProcessed,
    lots: result.lots.map(toStoredAcquisitionLot),
    disposals: result.disposals.map(toStoredLotDisposal),
    lotTransfers: result.lotTransfers.map(toStoredLotTransfer),
    executionMeta: {
      missingPricesCount: result.executionMeta.missingPricesCount,
      retainedTransactionIds: result.executionMeta.retainedTransactionIds,
    },
    ...(result.report ? { report: toStoredCostBasisReport(result.report) } : {}),
  };
}

export function fromStoredStandardArtifact(
  artifact: StoredStandardArtifact
): Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }> {
  const lots = artifact.lots.map(fromStoredAcquisitionLot);
  const disposals = artifact.disposals.map(fromStoredLotDisposal);
  const lotTransfers = artifact.lotTransfers.map(fromStoredLotTransfer);

  return {
    kind: 'standard-workflow',
    summary: {
      calculation: fromStoredCostBasisCalculation(artifact.calculation),
      lotsCreated: artifact.lotsCreated,
      disposalsProcessed: artifact.disposalsProcessed,
      totalCapitalGainLoss: parseDecimal(artifact.totalCapitalGainLoss),
      totalTaxableGainLoss: parseDecimal(artifact.totalTaxableGainLoss),
      assetsProcessed: artifact.assetsProcessed,
      lots,
      disposals,
      lotTransfers,
    },
    executionMeta: {
      missingPricesCount: artifact.executionMeta.missingPricesCount,
      retainedTransactionIds: artifact.executionMeta.retainedTransactionIds,
    },
    ...(artifact.report ? { report: fromStoredCostBasisReport(artifact.report) } : {}),
    lots,
    disposals,
    lotTransfers,
  };
}

export function buildStandardDebugPayload(
  artifact: Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }>
): CostBasisArtifactDebugPayload {
  const scopedTransactionIds = new Set<number>();
  const appliedConfirmedLinkIds = new Set<number>();

  for (const lot of artifact.lots) {
    scopedTransactionIds.add(lot.acquisitionTransactionId);
  }
  for (const disposal of artifact.disposals) {
    scopedTransactionIds.add(disposal.disposalTransactionId);
  }
  for (const transfer of artifact.lotTransfers) {
    scopedTransactionIds.add(transfer.sourceTransactionId);
    scopedTransactionIds.add(transfer.targetTransactionId);
    if (transfer.provenance.kind === 'confirmed-link') {
      appliedConfirmedLinkIds.add(transfer.provenance.linkId);
    }
  }

  return {
    kind: 'standard-workflow',
    scopedTransactionIds: [...scopedTransactionIds].sort((a, b) => a - b),
    appliedConfirmedLinkIds: [...appliedConfirmedLinkIds].sort((a, b) => a - b),
  };
}

export function toStoredStandardDebug(debug: CostBasisArtifactDebugPayload): StoredStandardDebug {
  return {
    kind: 'standard-workflow',
    scopedTransactionIds: debug.scopedTransactionIds,
    appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
  };
}

export function fromStoredDebug(debug: StoredCostBasisDebug): CostBasisArtifactDebugPayload {
  return debug.kind === 'standard-workflow'
    ? {
        kind: debug.kind,
        scopedTransactionIds: debug.scopedTransactionIds,
        appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
      }
    : fromStoredCanadaDebug(debug);
}

export function resolveStoredCostBasisCalculationWindow(
  calculation: CostBasisCalculation
): Result<{ endDate: Date; startDate: Date }, Error> {
  const startDate = calculation.startDate ?? calculation.config.startDate;
  const endDate = calculation.endDate ?? calculation.config.endDate;

  if (!startDate || !endDate) {
    return err(
      new Error(`Cannot persist cost-basis snapshot without calculation window dates for calculation ${calculation.id}`)
    );
  }

  return ok({ startDate, endDate });
}

function toStoredCostBasisCalculation(
  calculation: CostBasisCalculation,
  calculationWindow: { endDate: Date; startDate: Date }
): StoredCostBasisCalculation {
  return {
    id: calculation.id,
    calculationDate: calculation.calculationDate.toISOString(),
    config: {
      method: calculation.config.method,
      currency: calculation.config.currency,
      jurisdiction: calculation.config.jurisdiction,
      taxYear: calculation.config.taxYear,
      startDate: calculationWindow.startDate.toISOString(),
      endDate: calculationWindow.endDate.toISOString(),
      ...(calculation.config.specificLotSelectionStrategy
        ? { specificLotSelectionStrategy: calculation.config.specificLotSelectionStrategy }
        : {}),
    },
    startDate: calculationWindow.startDate.toISOString(),
    endDate: calculationWindow.endDate.toISOString(),
    totalProceeds: calculation.totalProceeds.toFixed(),
    totalCostBasis: calculation.totalCostBasis.toFixed(),
    totalGainLoss: calculation.totalGainLoss.toFixed(),
    totalTaxableGainLoss: calculation.totalTaxableGainLoss.toFixed(),
    assetsProcessed: calculation.assetsProcessed,
    transactionsProcessed: calculation.transactionsProcessed,
    lotsCreated: calculation.lotsCreated,
    disposalsProcessed: calculation.disposalsProcessed,
    status: calculation.status,
    ...(calculation.errorMessage ? { errorMessage: calculation.errorMessage } : {}),
    createdAt: calculation.createdAt.toISOString(),
    ...(calculation.completedAt ? { completedAt: calculation.completedAt.toISOString() } : {}),
  };
}

function fromStoredCostBasisCalculation(calculation: StoredCostBasisCalculation): CostBasisCalculation {
  return {
    id: calculation.id,
    calculationDate: new Date(calculation.calculationDate),
    config: {
      method: calculation.config.method,
      currency: calculation.config.currency,
      jurisdiction: calculation.config.jurisdiction,
      taxYear: calculation.config.taxYear,
      startDate: new Date(calculation.config.startDate),
      endDate: new Date(calculation.config.endDate),
      ...(calculation.config.specificLotSelectionStrategy
        ? { specificLotSelectionStrategy: calculation.config.specificLotSelectionStrategy }
        : {}),
    },
    startDate: new Date(calculation.startDate),
    endDate: new Date(calculation.endDate),
    totalProceeds: parseDecimal(calculation.totalProceeds),
    totalCostBasis: parseDecimal(calculation.totalCostBasis),
    totalGainLoss: parseDecimal(calculation.totalGainLoss),
    totalTaxableGainLoss: parseDecimal(calculation.totalTaxableGainLoss),
    assetsProcessed: calculation.assetsProcessed,
    transactionsProcessed: calculation.transactionsProcessed,
    lotsCreated: calculation.lotsCreated,
    disposalsProcessed: calculation.disposalsProcessed,
    status: calculation.status,
    ...(calculation.errorMessage ? { errorMessage: calculation.errorMessage } : {}),
    createdAt: new Date(calculation.createdAt),
    ...(calculation.completedAt ? { completedAt: new Date(calculation.completedAt) } : {}),
  };
}

function toStoredAcquisitionLot(lot: AcquisitionLot): StoredAcquisitionLot {
  return {
    id: lot.id,
    calculationId: lot.calculationId,
    acquisitionTransactionId: lot.acquisitionTransactionId,
    assetId: lot.assetId,
    assetSymbol: lot.assetSymbol,
    quantity: lot.quantity.toFixed(),
    costBasisPerUnit: lot.costBasisPerUnit.toFixed(),
    totalCostBasis: lot.totalCostBasis.toFixed(),
    acquisitionDate: lot.acquisitionDate.toISOString(),
    method: lot.method,
    remainingQuantity: lot.remainingQuantity.toFixed(),
    status: lot.status,
    createdAt: lot.createdAt.toISOString(),
    updatedAt: lot.updatedAt.toISOString(),
  };
}

function fromStoredAcquisitionLot(lot: StoredAcquisitionLot): AcquisitionLot {
  return {
    id: lot.id,
    calculationId: lot.calculationId,
    acquisitionTransactionId: lot.acquisitionTransactionId,
    assetId: lot.assetId,
    assetSymbol: lot.assetSymbol as Currency,
    quantity: parseDecimal(lot.quantity),
    costBasisPerUnit: parseDecimal(lot.costBasisPerUnit),
    totalCostBasis: parseDecimal(lot.totalCostBasis),
    acquisitionDate: new Date(lot.acquisitionDate),
    method: lot.method,
    remainingQuantity: parseDecimal(lot.remainingQuantity),
    status: lot.status,
    createdAt: new Date(lot.createdAt),
    updatedAt: new Date(lot.updatedAt),
  };
}

function toStoredLotDisposal(disposal: LotDisposal): StoredLotDisposal {
  return {
    id: disposal.id,
    lotId: disposal.lotId,
    disposalTransactionId: disposal.disposalTransactionId,
    quantityDisposed: disposal.quantityDisposed.toFixed(),
    proceedsPerUnit: disposal.proceedsPerUnit.toFixed(),
    totalProceeds: disposal.totalProceeds.toFixed(),
    grossProceeds: disposal.grossProceeds.toFixed(),
    sellingExpenses: disposal.sellingExpenses.toFixed(),
    netProceeds: disposal.netProceeds.toFixed(),
    costBasisPerUnit: disposal.costBasisPerUnit.toFixed(),
    totalCostBasis: disposal.totalCostBasis.toFixed(),
    gainLoss: disposal.gainLoss.toFixed(),
    disposalDate: disposal.disposalDate.toISOString(),
    holdingPeriodDays: disposal.holdingPeriodDays,
    ...(disposal.lossDisallowed !== undefined ? { lossDisallowed: disposal.lossDisallowed } : {}),
    ...(disposal.disallowedLossAmount ? { disallowedLossAmount: disposal.disallowedLossAmount.toFixed() } : {}),
    ...(disposal.taxTreatmentCategory ? { taxTreatmentCategory: disposal.taxTreatmentCategory } : {}),
    createdAt: disposal.createdAt.toISOString(),
  };
}

function fromStoredLotDisposal(disposal: StoredLotDisposal): LotDisposal {
  return {
    id: disposal.id,
    lotId: disposal.lotId,
    disposalTransactionId: disposal.disposalTransactionId,
    quantityDisposed: parseDecimal(disposal.quantityDisposed),
    proceedsPerUnit: parseDecimal(disposal.proceedsPerUnit),
    totalProceeds: parseDecimal(disposal.totalProceeds),
    grossProceeds: parseDecimal(disposal.grossProceeds),
    sellingExpenses: parseDecimal(disposal.sellingExpenses),
    netProceeds: parseDecimal(disposal.netProceeds),
    costBasisPerUnit: parseDecimal(disposal.costBasisPerUnit),
    totalCostBasis: parseDecimal(disposal.totalCostBasis),
    gainLoss: parseDecimal(disposal.gainLoss),
    disposalDate: new Date(disposal.disposalDate),
    holdingPeriodDays: disposal.holdingPeriodDays,
    ...(disposal.lossDisallowed !== undefined ? { lossDisallowed: disposal.lossDisallowed } : {}),
    ...(disposal.disallowedLossAmount ? { disallowedLossAmount: parseDecimal(disposal.disallowedLossAmount) } : {}),
    ...(disposal.taxTreatmentCategory ? { taxTreatmentCategory: disposal.taxTreatmentCategory } : {}),
    createdAt: new Date(disposal.createdAt),
  };
}

function toStoredLotTransfer(transfer: LotTransfer): StoredLotTransfer {
  return {
    id: transfer.id,
    calculationId: transfer.calculationId,
    sourceLotId: transfer.sourceLotId,
    provenance: transfer.provenance,
    quantityTransferred: transfer.quantityTransferred.toFixed(),
    costBasisPerUnit: transfer.costBasisPerUnit.toFixed(),
    sourceTransactionId: transfer.sourceTransactionId,
    targetTransactionId: transfer.targetTransactionId,
    transferDate: transfer.transferDate.toISOString(),
    createdAt: transfer.createdAt.toISOString(),
    ...(transfer.metadata?.sameAssetFeeUsdValue
      ? { metadata: { sameAssetFeeUsdValue: transfer.metadata.sameAssetFeeUsdValue.toFixed() } }
      : {}),
  };
}

function fromStoredLotTransfer(transfer: StoredLotTransfer): LotTransfer {
  return {
    id: transfer.id,
    calculationId: transfer.calculationId,
    sourceLotId: transfer.sourceLotId,
    provenance: transfer.provenance,
    quantityTransferred: parseDecimal(transfer.quantityTransferred),
    costBasisPerUnit: parseDecimal(transfer.costBasisPerUnit),
    sourceTransactionId: transfer.sourceTransactionId,
    targetTransactionId: transfer.targetTransactionId,
    transferDate: new Date(transfer.transferDate),
    createdAt: new Date(transfer.createdAt),
    ...(transfer.metadata?.sameAssetFeeUsdValue
      ? { metadata: { sameAssetFeeUsdValue: parseDecimal(transfer.metadata.sameAssetFeeUsdValue) } }
      : {}),
  };
}

function toStoredFxConversion(fx: FxConversionMetadata): StoredFxConversion {
  return {
    originalCurrency: fx.originalCurrency,
    displayCurrency: fx.displayCurrency,
    fxRate: fx.fxRate.toFixed(),
    fxSource: fx.fxSource,
    fxFetchedAt: fx.fxFetchedAt.toISOString(),
  };
}

function fromStoredFxConversion(fx: StoredFxConversion): FxConversionMetadata {
  return {
    originalCurrency: fx.originalCurrency,
    displayCurrency: fx.displayCurrency,
    fxRate: parseDecimal(fx.fxRate),
    fxSource: fx.fxSource,
    fxFetchedAt: new Date(fx.fxFetchedAt),
  };
}

function toStoredCostBasisReport(report: CostBasisReport): StoredCostBasisReport {
  return {
    calculationId: report.calculationId,
    displayCurrency: report.displayCurrency,
    originalCurrency: report.originalCurrency,
    disposals: report.disposals.map((item) => ({
      ...toStoredLotDisposal(item),
      displayProceedsPerUnit: item.displayProceedsPerUnit.toFixed(),
      displayTotalProceeds: item.displayTotalProceeds.toFixed(),
      displayCostBasisPerUnit: item.displayCostBasisPerUnit.toFixed(),
      displayTotalCostBasis: item.displayTotalCostBasis.toFixed(),
      displayGainLoss: item.displayGainLoss.toFixed(),
      fxConversion: toStoredFxConversion(item.fxConversion),
    })),
    lots: report.lots.map((item) => ({
      ...toStoredAcquisitionLot(item),
      displayCostBasisPerUnit: item.displayCostBasisPerUnit.toFixed(),
      displayTotalCostBasis: item.displayTotalCostBasis.toFixed(),
      fxConversion: toStoredFxConversion(item.fxConversion),
      ...(item.fxUnavailable ? { fxUnavailable: true, originalCurrency: item.originalCurrency ?? 'USD' } : {}),
    })),
    lotTransfers: report.lotTransfers.map((item) => ({
      ...toStoredLotTransfer(item),
      displayCostBasisPerUnit: item.displayCostBasisPerUnit.toFixed(),
      displayTotalCostBasis: item.displayTotalCostBasis.toFixed(),
      fxConversion: toStoredFxConversion(item.fxConversion),
      ...(item.fxUnavailable ? { fxUnavailable: true, originalCurrency: item.originalCurrency ?? 'USD' } : {}),
    })),
    summary: {
      totalCostBasis: report.summary.totalCostBasis.toFixed(),
      totalGainLoss: report.summary.totalGainLoss.toFixed(),
      totalProceeds: report.summary.totalProceeds.toFixed(),
      totalTaxableGainLoss: report.summary.totalTaxableGainLoss.toFixed(),
    },
    originalSummary: {
      totalCostBasis: report.originalSummary.totalCostBasis.toFixed(),
      totalGainLoss: report.originalSummary.totalGainLoss.toFixed(),
      totalProceeds: report.originalSummary.totalProceeds.toFixed(),
      totalTaxableGainLoss: report.originalSummary.totalTaxableGainLoss.toFixed(),
    },
  };
}

function fromStoredCostBasisReport(report: StoredCostBasisReport): CostBasisReport {
  return {
    calculationId: report.calculationId,
    displayCurrency: report.displayCurrency,
    originalCurrency: report.originalCurrency,
    disposals: report.disposals.map((item) => ({
      ...fromStoredLotDisposal(item),
      displayProceedsPerUnit: parseDecimal(item.displayProceedsPerUnit),
      displayTotalProceeds: parseDecimal(item.displayTotalProceeds),
      displayCostBasisPerUnit: parseDecimal(item.displayCostBasisPerUnit),
      displayTotalCostBasis: parseDecimal(item.displayTotalCostBasis),
      displayGainLoss: parseDecimal(item.displayGainLoss),
      fxConversion: fromStoredFxConversion(item.fxConversion),
    })) as ConvertedLotDisposal[],
    lots: report.lots.map((item) => ({
      ...fromStoredAcquisitionLot(item),
      displayCostBasisPerUnit: parseDecimal(item.displayCostBasisPerUnit),
      displayTotalCostBasis: parseDecimal(item.displayTotalCostBasis),
      fxConversion: fromStoredFxConversion(item.fxConversion),
      ...(item.fxUnavailable ? { fxUnavailable: true, originalCurrency: item.originalCurrency } : {}),
    })) as ConvertedAcquisitionLot[],
    lotTransfers: report.lotTransfers.map((item) => ({
      ...fromStoredLotTransfer(item),
      displayCostBasisPerUnit: parseDecimal(item.displayCostBasisPerUnit),
      displayTotalCostBasis: parseDecimal(item.displayTotalCostBasis),
      fxConversion: fromStoredFxConversion(item.fxConversion),
      ...(item.fxUnavailable ? { fxUnavailable: true, originalCurrency: item.originalCurrency } : {}),
    })) as ConvertedLotTransfer[],
    summary: {
      totalCostBasis: parseDecimal(report.summary.totalCostBasis),
      totalGainLoss: parseDecimal(report.summary.totalGainLoss),
      totalProceeds: parseDecimal(report.summary.totalProceeds),
      totalTaxableGainLoss: parseDecimal(report.summary.totalTaxableGainLoss),
    },
    originalSummary: {
      totalCostBasis: parseDecimal(report.originalSummary.totalCostBasis),
      totalGainLoss: parseDecimal(report.originalSummary.totalGainLoss),
      totalProceeds: parseDecimal(report.originalSummary.totalProceeds),
      totalTaxableGainLoss: parseDecimal(report.originalSummary.totalTaxableGainLoss),
    },
  };
}
