import { parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import { z } from 'zod';

import {
  DecimalStringSchema,
  IsoDateTimeStringSchema,
  StoredCostBasisExecutionMetaSchema,
  type CostBasisArtifactDebugPayload,
} from '../../../artifacts/artifact-storage-shared.js';
import type { CanadaCostBasisWorkflowResult } from '../../../workflow/workflow-result-types.js';
import type {
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaSuperficialLossAdjustment,
  CanadaTaxInputContext,
  CanadaTaxInputEvent,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
  CanadaTaxValuation,
} from '../tax/canada-tax-types.js';

const StoredCanadaDisplayFxConversionSchema = z.object({
  sourceTaxCurrency: z.literal('CAD'),
  displayCurrency: z.string().min(1),
  fxRate: DecimalStringSchema,
  fxSource: z.string().min(1),
  fxFetchedAt: IsoDateTimeStringSchema,
});

const StoredCanadaCalculationSchema = z.object({
  id: z.string().uuid(),
  calculationDate: IsoDateTimeStringSchema,
  method: z.literal('average-cost'),
  jurisdiction: z.literal('CA'),
  taxYear: z.number().int().min(2000).max(2100),
  displayCurrency: z.string().min(1),
  taxCurrency: z.literal('CAD'),
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  transactionsProcessed: z.number().int().nonnegative(),
  assetsProcessed: z.array(z.string().min(1)),
});

const StoredCanadaTaxReportAcquisitionSchema = z.object({
  id: z.string().min(1),
  acquisitionEventId: z.string().min(1),
  transactionId: z.number().int().positive(),
  taxPropertyKey: z.string().min(1),
  assetSymbol: z.string().min(1),
  acquiredAt: IsoDateTimeStringSchema,
  quantityAcquired: DecimalStringSchema,
  remainingQuantity: DecimalStringSchema,
  totalCostCad: DecimalStringSchema,
  remainingAllocatedAcbCad: DecimalStringSchema,
  costBasisPerUnitCad: DecimalStringSchema,
  incomeCategory: z.literal('staking_reward').optional(),
});

const StoredCanadaTaxReportDispositionSchema = z.object({
  id: z.string().min(1),
  dispositionEventId: z.string().min(1),
  transactionId: z.number().int().positive(),
  taxPropertyKey: z.string().min(1),
  assetSymbol: z.string().min(1),
  disposedAt: IsoDateTimeStringSchema,
  quantityDisposed: DecimalStringSchema,
  proceedsCad: DecimalStringSchema,
  costBasisCad: DecimalStringSchema,
  gainLossCad: DecimalStringSchema,
  deniedLossCad: DecimalStringSchema,
  taxableGainLossCad: DecimalStringSchema,
  acbPerUnitCad: DecimalStringSchema,
});

const StoredCanadaTaxReportTransferSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['in', 'internal', 'out']),
  sourceTransferEventId: z.string().min(1).optional(),
  targetTransferEventId: z.string().min(1).optional(),
  sourceTransactionId: z.number().int().positive().optional(),
  targetTransactionId: z.number().int().positive().optional(),
  linkId: z.number().int().positive().optional(),
  transactionId: z.number().int().positive(),
  taxPropertyKey: z.string().min(1),
  assetSymbol: z.string().min(1),
  transferredAt: IsoDateTimeStringSchema,
  quantity: DecimalStringSchema,
  carriedAcbCad: DecimalStringSchema,
  carriedAcbPerUnitCad: DecimalStringSchema,
  feeAdjustmentCad: DecimalStringSchema,
});

const StoredCanadaSuperficialLossAdjustmentSchema = z.object({
  id: z.string().min(1),
  adjustedAt: IsoDateTimeStringSchema,
  assetSymbol: z.string().min(1),
  deniedLossCad: DecimalStringSchema,
  deniedQuantity: DecimalStringSchema,
  relatedDispositionId: z.string().min(1),
  taxPropertyKey: z.string().min(1),
  substitutedPropertyAcquisitionId: z.string().min(1),
});

const StoredCanadaTaxReportSchema = z.object({
  calculationId: z.string().uuid(),
  taxCurrency: z.literal('CAD'),
  acquisitions: z.array(StoredCanadaTaxReportAcquisitionSchema),
  dispositions: z.array(StoredCanadaTaxReportDispositionSchema),
  transfers: z.array(StoredCanadaTaxReportTransferSchema),
  superficialLossAdjustments: z.array(StoredCanadaSuperficialLossAdjustmentSchema),
  summary: z.object({
    totalProceedsCad: DecimalStringSchema,
    totalCostBasisCad: DecimalStringSchema,
    totalGainLossCad: DecimalStringSchema,
    totalTaxableGainLossCad: DecimalStringSchema,
    totalDeniedLossCad: DecimalStringSchema,
  }),
  displayContext: z.object({
    transferMarketValueCadByTransferId: z.record(z.string(), DecimalStringSchema),
  }),
});

const StoredMoneySchema = z.object({
  amount: DecimalStringSchema,
  currency: z.string().min(1),
});

const StoredPriceAtTxTimeSchema = z.object({
  price: StoredMoneySchema,
  quotedPrice: StoredMoneySchema.optional(),
  source: z.string().min(1),
  fetchedAt: IsoDateTimeStringSchema,
  granularity: z.enum(['exact', 'minute', 'hour', 'day']).optional(),
  fxRateToUSD: DecimalStringSchema.optional(),
  fxSource: z.string().optional(),
  fxTimestamp: IsoDateTimeStringSchema.optional(),
});

const StoredCanadaTaxValuationSchema = z.object({
  taxCurrency: z.literal('CAD'),
  storagePriceAmount: DecimalStringSchema,
  storagePriceCurrency: z.string().min(1),
  quotedPriceAmount: DecimalStringSchema,
  quotedPriceCurrency: z.string().min(1),
  unitValueCad: DecimalStringSchema,
  totalValueCad: DecimalStringSchema,
  valuationSource: z.enum(['quoted-price', 'stored-price', 'usd-to-cad-fx', 'fiat-to-cad-fx']),
  fxRateToCad: DecimalStringSchema.optional(),
  fxSource: z.string().optional(),
  fxTimestamp: IsoDateTimeStringSchema.optional(),
});

const StoredCanadaInputEventBaseSchema = z.object({
  eventId: z.string().min(1),
  transactionId: z.number().int().positive(),
  timestamp: IsoDateTimeStringSchema,
  assetId: z.string().min(1),
  assetIdentityKey: z.string().min(1),
  taxPropertyKey: z.string().min(1),
  assetSymbol: z.string().min(1),
  valuation: StoredCanadaTaxValuationSchema,
  provenanceKind: z.enum(['movement', 'validated-link', 'internal-transfer-carryover', 'superficial-loss-engine']),
  linkId: z.number().int().positive().optional(),
  movementFingerprint: z.string().min(1).optional(),
  sourceMovementFingerprint: z.string().min(1).optional(),
  sourceTransactionId: z.number().int().positive().optional(),
  targetMovementFingerprint: z.string().min(1).optional(),
  priceAtTxTime: StoredPriceAtTxTimeSchema.optional(),
});

const StoredCanadaAcquisitionEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('acquisition'),
  quantity: DecimalStringSchema,
  costBasisAdjustmentCad: DecimalStringSchema.optional(),
  incomeCategory: z.literal('staking_reward').optional(),
});

const StoredCanadaDispositionEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('disposition'),
  quantity: DecimalStringSchema,
  proceedsReductionCad: DecimalStringSchema.optional(),
});

const StoredCanadaTransferInEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('transfer-in'),
  quantity: DecimalStringSchema,
});

const StoredCanadaTransferOutEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('transfer-out'),
  quantity: DecimalStringSchema,
});

const StoredCanadaFeeAdjustmentEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('fee-adjustment'),
  adjustmentType: z.enum(['add-to-pool-cost', 'same-asset-transfer-fee-add-to-basis']),
  feeAssetId: z.string().min(1),
  feeAssetIdentityKey: z.string().min(1).optional(),
  feeAssetSymbol: z.string().min(1),
  feeQuantity: DecimalStringSchema,
  quantityReduced: DecimalStringSchema.optional(),
  relatedEventId: z.string().min(1).optional(),
});

const StoredCanadaSuperficialLossAdjustmentEventSchema = StoredCanadaInputEventBaseSchema.extend({
  kind: z.literal('superficial-loss-adjustment'),
  deniedLossCad: DecimalStringSchema,
  deniedQuantity: DecimalStringSchema,
  relatedDispositionEventId: z.string().min(1),
});

const StoredCanadaInputEventSchema = z.discriminatedUnion('kind', [
  StoredCanadaAcquisitionEventSchema,
  StoredCanadaDispositionEventSchema,
  StoredCanadaTransferInEventSchema,
  StoredCanadaTransferOutEventSchema,
  StoredCanadaFeeAdjustmentEventSchema,
  StoredCanadaSuperficialLossAdjustmentEventSchema,
]);

const StoredCanadaTaxInputContextSchema = z.object({
  taxCurrency: z.literal('CAD'),
  inputTransactionIds: z.array(z.number().int().positive()),
  validatedTransferLinkIds: z.array(z.number().int().positive()),
  internalTransferCarryoverSourceTransactionIds: z.array(z.number().int().positive()),
  inputEvents: z.array(StoredCanadaInputEventSchema),
});

const StoredCanadaDisplayReportAcquisitionSchema = StoredCanadaTaxReportAcquisitionSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCost: DecimalStringSchema,
  displayRemainingAllocatedCost: DecimalStringSchema,
  fxConversion: StoredCanadaDisplayFxConversionSchema,
});

const StoredCanadaDisplayReportDispositionSchema = StoredCanadaTaxReportDispositionSchema.extend({
  displayProceeds: DecimalStringSchema,
  displayCostBasis: DecimalStringSchema,
  displayGainLoss: DecimalStringSchema,
  displayDeniedLoss: DecimalStringSchema,
  displayTaxableGainLoss: DecimalStringSchema,
  displayAcbPerUnit: DecimalStringSchema,
  fxConversion: StoredCanadaDisplayFxConversionSchema,
});

const StoredCanadaDisplayReportTransferSchema = StoredCanadaTaxReportTransferSchema.extend({
  marketValueCad: DecimalStringSchema,
  displayCarriedAcb: DecimalStringSchema,
  displayCarriedAcbPerUnit: DecimalStringSchema,
  displayMarketValue: DecimalStringSchema,
  displayFeeAdjustment: DecimalStringSchema,
  fxConversion: StoredCanadaDisplayFxConversionSchema,
});

const StoredCanadaDisplayCostBasisReportSchema = z.object({
  calculationId: z.string().uuid(),
  sourceTaxCurrency: z.literal('CAD'),
  displayCurrency: z.string().min(1),
  acquisitions: z.array(StoredCanadaDisplayReportAcquisitionSchema),
  dispositions: z.array(StoredCanadaDisplayReportDispositionSchema),
  transfers: z.array(StoredCanadaDisplayReportTransferSchema),
  summary: z.object({
    totalProceeds: DecimalStringSchema,
    totalCostBasis: DecimalStringSchema,
    totalGainLoss: DecimalStringSchema,
    totalTaxableGainLoss: DecimalStringSchema,
    totalDeniedLoss: DecimalStringSchema,
  }),
});

export const StoredCanadaCostBasisArtifactSchema = z.object({
  kind: z.literal('canada-workflow'),
  calculation: StoredCanadaCalculationSchema,
  taxReport: StoredCanadaTaxReportSchema,
  inputContext: StoredCanadaTaxInputContextSchema,
  displayReport: StoredCanadaDisplayCostBasisReportSchema.optional(),
  executionMeta: StoredCostBasisExecutionMetaSchema,
});

export const StoredCanadaDebugSchema = z.object({
  kind: z.literal('canada-workflow'),
  inputTransactionIds: z.array(z.number().int().positive()),
  appliedConfirmedLinkIds: z.array(z.number().int().positive()),
  acquisitionEventIds: z.array(z.string().min(1)),
  dispositionEventIds: z.array(z.string().min(1)),
  transferIds: z.array(z.string().min(1)),
  superficialLossAdjustmentIds: z.array(z.string().min(1)),
});

type StoredCanadaArtifact = z.infer<typeof StoredCanadaCostBasisArtifactSchema>;
type StoredCanadaDebug = z.infer<typeof StoredCanadaDebugSchema>;

interface CanadaArtifactSnapshotParts {
  artifact: StoredCanadaArtifact;
  debug: StoredCanadaDebug;
  debugPayload: CostBasisArtifactDebugPayload;
  metadata: {
    calculationId: string;
    displayCurrency: string;
    endDate: string;
    jurisdiction: 'CA';
    method: 'average-cost';
    startDate: string;
    taxYear: number;
  };
}

function buildCanadaArtifactDebugPayload(artifact: CanadaCostBasisWorkflowResult): CostBasisArtifactDebugPayload {
  const linkIds = artifact.taxReport.transfers
    .map((transfer) => transfer.linkId)
    .filter((linkId): linkId is number => typeof linkId === 'number');

  return {
    kind: 'canada-workflow',
    inputTransactionIds: uniqueSortedNumbers([
      ...artifact.taxReport.acquisitions.map((item) => item.transactionId),
      ...artifact.taxReport.dispositions.map((item) => item.transactionId),
      ...artifact.taxReport.transfers.map((item) => item.transactionId),
    ]),
    appliedConfirmedLinkIds: uniqueSortedNumbers(linkIds),
    acquisitionEventIds: artifact.taxReport.acquisitions.map((item) => item.acquisitionEventId),
    dispositionEventIds: artifact.taxReport.dispositions.map((item) => item.dispositionEventId),
    transferIds: artifact.taxReport.transfers.map((item) => item.id),
    superficialLossAdjustmentIds: artifact.taxReport.superficialLossAdjustments.map((item) => item.id),
  };
}

export function buildCanadaArtifactSnapshotParts(
  result: CanadaCostBasisWorkflowResult
): Result<CanadaArtifactSnapshotParts, Error> {
  const inputContextResult = requirePersistableCanadaInputContext(result);
  if (inputContextResult.isErr()) {
    return err(inputContextResult.error);
  }

  const debugPayload = buildCanadaArtifactDebugPayload(result);

  return ok({
    artifact: toStoredCanadaArtifact(result, inputContextResult.value),
    debug: toStoredCanadaDebug(debugPayload),
    debugPayload,
    metadata: {
      calculationId: result.calculation.id,
      displayCurrency: result.displayReport?.displayCurrency ?? result.calculation.displayCurrency,
      endDate: result.calculation.endDate.toISOString(),
      jurisdiction: result.calculation.jurisdiction,
      method: result.calculation.method,
      startDate: result.calculation.startDate.toISOString(),
      taxYear: result.calculation.taxYear,
    },
  });
}

export function fromStoredCanadaArtifact(artifact: StoredCanadaArtifact): CanadaCostBasisWorkflowResult {
  return {
    kind: 'canada-workflow',
    calculation: {
      id: artifact.calculation.id,
      calculationDate: new Date(artifact.calculation.calculationDate),
      method: artifact.calculation.method,
      jurisdiction: artifact.calculation.jurisdiction,
      taxYear: artifact.calculation.taxYear,
      displayCurrency: artifact.calculation.displayCurrency as Currency,
      taxCurrency: artifact.calculation.taxCurrency,
      startDate: new Date(artifact.calculation.startDate),
      endDate: new Date(artifact.calculation.endDate),
      transactionsProcessed: artifact.calculation.transactionsProcessed,
      assetsProcessed: artifact.calculation.assetsProcessed,
    },
    taxReport: fromStoredCanadaTaxReport(artifact.taxReport),
    inputContext: fromStoredCanadaInputContext(artifact.inputContext),
    ...(artifact.displayReport ? { displayReport: fromStoredCanadaDisplayReport(artifact.displayReport) } : {}),
    executionMeta: {
      missingPricesCount: artifact.executionMeta.missingPricesCount,
      missingPriceTransactionIds: artifact.executionMeta.missingPriceTransactionIds,
      retainedTransactionIds: artifact.executionMeta.retainedTransactionIds,
    },
  };
}

export function fromStoredCanadaDebug(debug: StoredCanadaDebug): CostBasisArtifactDebugPayload {
  return {
    kind: debug.kind,
    inputTransactionIds: debug.inputTransactionIds,
    appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
    acquisitionEventIds: debug.acquisitionEventIds,
    dispositionEventIds: debug.dispositionEventIds,
    transferIds: debug.transferIds,
    superficialLossAdjustmentIds: debug.superficialLossAdjustmentIds,
  };
}

function requirePersistableCanadaInputContext(
  result: CanadaCostBasisWorkflowResult
): Result<CanadaTaxInputContext, Error> {
  if (!result.inputContext) {
    return err(
      new Error(
        `Cannot persist Canada cost-basis snapshot without input context for calculation ${result.calculation.id}`
      )
    );
  }

  return ok(result.inputContext);
}

function toStoredCanadaArtifact(
  result: CanadaCostBasisWorkflowResult,
  inputContext: CanadaTaxInputContext
): StoredCanadaArtifact {
  return {
    kind: 'canada-workflow',
    calculation: {
      id: result.calculation.id,
      calculationDate: result.calculation.calculationDate.toISOString(),
      method: result.calculation.method,
      jurisdiction: result.calculation.jurisdiction,
      taxYear: result.calculation.taxYear,
      displayCurrency: result.calculation.displayCurrency,
      taxCurrency: result.calculation.taxCurrency,
      startDate: result.calculation.startDate.toISOString(),
      endDate: result.calculation.endDate.toISOString(),
      transactionsProcessed: result.calculation.transactionsProcessed,
      assetsProcessed: result.calculation.assetsProcessed,
    },
    taxReport: toStoredCanadaTaxReport(result.taxReport),
    inputContext: toStoredCanadaInputContext(inputContext),
    ...(result.displayReport ? { displayReport: toStoredCanadaDisplayReport(result.displayReport) } : {}),
    executionMeta: {
      missingPricesCount: result.executionMeta.missingPricesCount,
      missingPriceTransactionIds: result.executionMeta.missingPriceTransactionIds,
      retainedTransactionIds: result.executionMeta.retainedTransactionIds,
    },
  };
}

function toStoredCanadaDebug(debug: CostBasisArtifactDebugPayload): StoredCanadaDebug {
  return {
    kind: 'canada-workflow',
    inputTransactionIds: debug.inputTransactionIds,
    appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
    acquisitionEventIds: debug.acquisitionEventIds ?? [],
    dispositionEventIds: debug.dispositionEventIds ?? [],
    transferIds: debug.transferIds ?? [],
    superficialLossAdjustmentIds: debug.superficialLossAdjustmentIds ?? [],
  };
}

function toStoredCanadaTaxReport(report: CanadaTaxReport): z.infer<typeof StoredCanadaTaxReportSchema> {
  return {
    calculationId: report.calculationId,
    taxCurrency: report.taxCurrency,
    acquisitions: report.acquisitions.map(toStoredCanadaTaxReportAcquisition),
    dispositions: report.dispositions.map(toStoredCanadaTaxReportDisposition),
    transfers: report.transfers.map(toStoredCanadaTaxReportTransfer),
    superficialLossAdjustments: report.superficialLossAdjustments.map(toStoredCanadaSuperficialLossAdjustment),
    summary: {
      totalProceedsCad: report.summary.totalProceedsCad.toFixed(),
      totalCostBasisCad: report.summary.totalCostBasisCad.toFixed(),
      totalGainLossCad: report.summary.totalGainLossCad.toFixed(),
      totalTaxableGainLossCad: report.summary.totalTaxableGainLossCad.toFixed(),
      totalDeniedLossCad: report.summary.totalDeniedLossCad.toFixed(),
    },
    displayContext: {
      transferMarketValueCadByTransferId: Object.fromEntries(
        [...report.displayContext.transferMarketValueCadByTransferId.entries()].map(([key, value]) => [
          key,
          value.toFixed(),
        ])
      ),
    },
  };
}

function fromStoredCanadaTaxReport(report: z.infer<typeof StoredCanadaTaxReportSchema>): CanadaTaxReport {
  return {
    calculationId: report.calculationId,
    taxCurrency: report.taxCurrency,
    acquisitions: report.acquisitions.map(fromStoredCanadaTaxReportAcquisition),
    dispositions: report.dispositions.map(fromStoredCanadaTaxReportDisposition),
    transfers: report.transfers.map(fromStoredCanadaTaxReportTransfer),
    superficialLossAdjustments: report.superficialLossAdjustments.map(fromStoredCanadaSuperficialLossAdjustment),
    summary: {
      totalProceedsCad: parseDecimal(report.summary.totalProceedsCad),
      totalCostBasisCad: parseDecimal(report.summary.totalCostBasisCad),
      totalGainLossCad: parseDecimal(report.summary.totalGainLossCad),
      totalTaxableGainLossCad: parseDecimal(report.summary.totalTaxableGainLossCad),
      totalDeniedLossCad: parseDecimal(report.summary.totalDeniedLossCad),
    },
    displayContext: {
      transferMarketValueCadByTransferId: new Map(
        Object.entries(report.displayContext.transferMarketValueCadByTransferId).map(([key, value]) => [
          key,
          parseDecimal(value),
        ])
      ),
    },
  };
}

function toStoredCanadaDisplayFxConversion(
  fx: CanadaDisplayFxConversion
): z.infer<typeof StoredCanadaDisplayFxConversionSchema> {
  return {
    sourceTaxCurrency: fx.sourceTaxCurrency,
    displayCurrency: fx.displayCurrency,
    fxRate: fx.fxRate.toFixed(),
    fxSource: fx.fxSource,
    fxFetchedAt: fx.fxFetchedAt.toISOString(),
  };
}

function fromStoredCanadaDisplayFxConversion(
  fx: z.infer<typeof StoredCanadaDisplayFxConversionSchema>
): CanadaDisplayFxConversion {
  return {
    sourceTaxCurrency: fx.sourceTaxCurrency,
    displayCurrency: fx.displayCurrency as Currency,
    fxRate: parseDecimal(fx.fxRate),
    fxSource: fx.fxSource,
    fxFetchedAt: new Date(fx.fxFetchedAt),
  };
}

function toStoredCanadaDisplayReport(
  report: CanadaDisplayCostBasisReport
): z.infer<typeof StoredCanadaDisplayCostBasisReportSchema> {
  return {
    calculationId: report.calculationId,
    sourceTaxCurrency: report.sourceTaxCurrency,
    displayCurrency: report.displayCurrency,
    acquisitions: report.acquisitions.map((item) => ({
      ...toStoredCanadaTaxReportAcquisition(item),
      displayCostBasisPerUnit: item.displayCostBasisPerUnit.toFixed(),
      displayTotalCost: item.displayTotalCost.toFixed(),
      displayRemainingAllocatedCost: item.displayRemainingAllocatedCost.toFixed(),
      fxConversion: toStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    dispositions: report.dispositions.map((item) => ({
      ...toStoredCanadaTaxReportDisposition(item),
      displayProceeds: item.displayProceeds.toFixed(),
      displayCostBasis: item.displayCostBasis.toFixed(),
      displayGainLoss: item.displayGainLoss.toFixed(),
      displayDeniedLoss: item.displayDeniedLoss.toFixed(),
      displayTaxableGainLoss: item.displayTaxableGainLoss.toFixed(),
      displayAcbPerUnit: item.displayAcbPerUnit.toFixed(),
      fxConversion: toStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    transfers: report.transfers.map((item) => ({
      ...toStoredCanadaTaxReportTransfer(item),
      marketValueCad: item.marketValueCad.toFixed(),
      displayCarriedAcb: item.displayCarriedAcb.toFixed(),
      displayCarriedAcbPerUnit: item.displayCarriedAcbPerUnit.toFixed(),
      displayMarketValue: item.displayMarketValue.toFixed(),
      displayFeeAdjustment: item.displayFeeAdjustment.toFixed(),
      fxConversion: toStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    summary: {
      totalProceeds: report.summary.totalProceeds.toFixed(),
      totalCostBasis: report.summary.totalCostBasis.toFixed(),
      totalGainLoss: report.summary.totalGainLoss.toFixed(),
      totalTaxableGainLoss: report.summary.totalTaxableGainLoss.toFixed(),
      totalDeniedLoss: report.summary.totalDeniedLoss.toFixed(),
    },
  };
}

function fromStoredCanadaDisplayReport(
  report: z.infer<typeof StoredCanadaDisplayCostBasisReportSchema>
): CanadaDisplayCostBasisReport {
  return {
    calculationId: report.calculationId,
    sourceTaxCurrency: report.sourceTaxCurrency,
    displayCurrency: report.displayCurrency as Currency,
    acquisitions: report.acquisitions.map((item) => ({
      ...fromStoredCanadaTaxReportAcquisition(item),
      displayCostBasisPerUnit: parseDecimal(item.displayCostBasisPerUnit),
      displayTotalCost: parseDecimal(item.displayTotalCost),
      displayRemainingAllocatedCost: parseDecimal(item.displayRemainingAllocatedCost),
      fxConversion: fromStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    dispositions: report.dispositions.map((item) => ({
      ...fromStoredCanadaTaxReportDisposition(item),
      displayProceeds: parseDecimal(item.displayProceeds),
      displayCostBasis: parseDecimal(item.displayCostBasis),
      displayGainLoss: parseDecimal(item.displayGainLoss),
      displayDeniedLoss: parseDecimal(item.displayDeniedLoss),
      displayTaxableGainLoss: parseDecimal(item.displayTaxableGainLoss),
      displayAcbPerUnit: parseDecimal(item.displayAcbPerUnit),
      fxConversion: fromStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    transfers: report.transfers.map((item) => ({
      ...fromStoredCanadaTaxReportTransfer(item),
      marketValueCad: parseDecimal(item.marketValueCad),
      displayCarriedAcb: parseDecimal(item.displayCarriedAcb),
      displayCarriedAcbPerUnit: parseDecimal(item.displayCarriedAcbPerUnit),
      displayMarketValue: parseDecimal(item.displayMarketValue),
      displayFeeAdjustment: parseDecimal(item.displayFeeAdjustment),
      fxConversion: fromStoredCanadaDisplayFxConversion(item.fxConversion),
    })),
    summary: {
      totalProceeds: parseDecimal(report.summary.totalProceeds),
      totalCostBasis: parseDecimal(report.summary.totalCostBasis),
      totalGainLoss: parseDecimal(report.summary.totalGainLoss),
      totalTaxableGainLoss: parseDecimal(report.summary.totalTaxableGainLoss),
      totalDeniedLoss: parseDecimal(report.summary.totalDeniedLoss),
    },
  };
}

function toStoredMoney(value: { amount: Decimal; currency: string }): z.infer<typeof StoredMoneySchema> {
  return {
    amount: value.amount.toFixed(),
    currency: value.currency,
  };
}

function fromStoredMoney(value: z.infer<typeof StoredMoneySchema>): { amount: Decimal; currency: Currency } {
  return {
    amount: parseDecimal(value.amount),
    currency: value.currency as Currency,
  };
}

function toStoredPriceAtTxTime(
  value: NonNullable<CanadaTaxInputEvent['priceAtTxTime']>
): z.infer<typeof StoredPriceAtTxTimeSchema> {
  return {
    price: toStoredMoney(value.price),
    ...(value.quotedPrice ? { quotedPrice: toStoredMoney(value.quotedPrice) } : {}),
    source: value.source,
    fetchedAt: value.fetchedAt.toISOString(),
    ...(value.granularity ? { granularity: value.granularity } : {}),
    ...(value.fxRateToUSD !== undefined ? { fxRateToUSD: value.fxRateToUSD.toFixed() } : {}),
    ...(value.fxSource ? { fxSource: value.fxSource } : {}),
    ...(value.fxTimestamp ? { fxTimestamp: value.fxTimestamp.toISOString() } : {}),
  };
}

function fromStoredPriceAtTxTime(
  value: z.infer<typeof StoredPriceAtTxTimeSchema>
): NonNullable<CanadaTaxInputEvent['priceAtTxTime']> {
  return {
    price: fromStoredMoney(value.price),
    ...(value.quotedPrice ? { quotedPrice: fromStoredMoney(value.quotedPrice) } : {}),
    source: value.source,
    fetchedAt: new Date(value.fetchedAt),
    ...(value.granularity ? { granularity: value.granularity } : {}),
    ...(value.fxRateToUSD !== undefined ? { fxRateToUSD: parseDecimal(value.fxRateToUSD) } : {}),
    ...(value.fxSource ? { fxSource: value.fxSource } : {}),
    ...(value.fxTimestamp ? { fxTimestamp: new Date(value.fxTimestamp) } : {}),
  };
}

function toStoredCanadaTaxValuation(valuation: CanadaTaxValuation): z.infer<typeof StoredCanadaTaxValuationSchema> {
  return {
    taxCurrency: valuation.taxCurrency,
    storagePriceAmount: valuation.storagePriceAmount.toFixed(),
    storagePriceCurrency: valuation.storagePriceCurrency,
    quotedPriceAmount: valuation.quotedPriceAmount.toFixed(),
    quotedPriceCurrency: valuation.quotedPriceCurrency,
    unitValueCad: valuation.unitValueCad.toFixed(),
    totalValueCad: valuation.totalValueCad.toFixed(),
    valuationSource: valuation.valuationSource,
    ...(valuation.fxRateToCad !== undefined ? { fxRateToCad: valuation.fxRateToCad.toFixed() } : {}),
    ...(valuation.fxSource ? { fxSource: valuation.fxSource } : {}),
    ...(valuation.fxTimestamp ? { fxTimestamp: valuation.fxTimestamp.toISOString() } : {}),
  };
}

function fromStoredCanadaTaxValuation(valuation: z.infer<typeof StoredCanadaTaxValuationSchema>): CanadaTaxValuation {
  return {
    taxCurrency: valuation.taxCurrency,
    storagePriceAmount: parseDecimal(valuation.storagePriceAmount),
    storagePriceCurrency: valuation.storagePriceCurrency as Currency,
    quotedPriceAmount: parseDecimal(valuation.quotedPriceAmount),
    quotedPriceCurrency: valuation.quotedPriceCurrency as Currency,
    unitValueCad: parseDecimal(valuation.unitValueCad),
    totalValueCad: parseDecimal(valuation.totalValueCad),
    valuationSource: valuation.valuationSource,
    ...(valuation.fxRateToCad !== undefined ? { fxRateToCad: parseDecimal(valuation.fxRateToCad) } : {}),
    ...(valuation.fxSource ? { fxSource: valuation.fxSource } : {}),
    ...(valuation.fxTimestamp ? { fxTimestamp: new Date(valuation.fxTimestamp) } : {}),
  };
}

function toStoredCanadaInputEventBase(event: CanadaTaxInputEvent): z.infer<typeof StoredCanadaInputEventBaseSchema> {
  return {
    eventId: event.eventId,
    transactionId: event.transactionId,
    timestamp: event.timestamp.toISOString(),
    assetId: event.assetId,
    assetIdentityKey: event.assetIdentityKey,
    taxPropertyKey: event.taxPropertyKey,
    assetSymbol: event.assetSymbol,
    valuation: toStoredCanadaTaxValuation(event.valuation),
    provenanceKind: event.provenanceKind,
    ...(event.linkId !== undefined ? { linkId: event.linkId } : {}),
    ...(event.movementFingerprint ? { movementFingerprint: event.movementFingerprint } : {}),
    ...(event.sourceMovementFingerprint ? { sourceMovementFingerprint: event.sourceMovementFingerprint } : {}),
    ...(event.sourceTransactionId !== undefined ? { sourceTransactionId: event.sourceTransactionId } : {}),
    ...(event.targetMovementFingerprint ? { targetMovementFingerprint: event.targetMovementFingerprint } : {}),
    ...(event.priceAtTxTime ? { priceAtTxTime: toStoredPriceAtTxTime(event.priceAtTxTime) } : {}),
  };
}

function fromStoredCanadaInputEventBase(
  event: z.infer<typeof StoredCanadaInputEventSchema>
): Omit<CanadaTaxInputEvent, 'kind'> {
  return {
    eventId: event.eventId,
    transactionId: event.transactionId,
    timestamp: new Date(event.timestamp),
    assetId: event.assetId,
    assetIdentityKey: event.assetIdentityKey,
    taxPropertyKey: event.taxPropertyKey,
    assetSymbol: event.assetSymbol as Currency,
    valuation: fromStoredCanadaTaxValuation(event.valuation),
    provenanceKind: event.provenanceKind,
    ...(event.linkId !== undefined ? { linkId: event.linkId } : {}),
    ...(event.movementFingerprint ? { movementFingerprint: event.movementFingerprint } : {}),
    ...(event.sourceMovementFingerprint ? { sourceMovementFingerprint: event.sourceMovementFingerprint } : {}),
    ...(event.sourceTransactionId !== undefined ? { sourceTransactionId: event.sourceTransactionId } : {}),
    ...(event.targetMovementFingerprint ? { targetMovementFingerprint: event.targetMovementFingerprint } : {}),
    ...(event.priceAtTxTime ? { priceAtTxTime: fromStoredPriceAtTxTime(event.priceAtTxTime) } : {}),
  };
}

function toStoredCanadaInputEvent(event: CanadaTaxInputEvent): z.infer<typeof StoredCanadaInputEventSchema> {
  const base = toStoredCanadaInputEventBase(event);

  switch (event.kind) {
    case 'acquisition':
      return {
        ...base,
        kind: event.kind,
        quantity: event.quantity.toFixed(),
        ...(event.costBasisAdjustmentCad !== undefined
          ? { costBasisAdjustmentCad: event.costBasisAdjustmentCad.toFixed() }
          : {}),
        ...(event.incomeCategory !== undefined ? { incomeCategory: event.incomeCategory } : {}),
      };
    case 'disposition':
      return {
        ...base,
        kind: event.kind,
        quantity: event.quantity.toFixed(),
        ...(event.proceedsReductionCad !== undefined
          ? { proceedsReductionCad: event.proceedsReductionCad.toFixed() }
          : {}),
      };
    case 'transfer-in':
    case 'transfer-out':
      return {
        ...base,
        kind: event.kind,
        quantity: event.quantity.toFixed(),
      };
    case 'fee-adjustment':
      return {
        ...base,
        kind: event.kind,
        adjustmentType: event.adjustmentType,
        feeAssetId: event.feeAssetId,
        ...(event.feeAssetIdentityKey ? { feeAssetIdentityKey: event.feeAssetIdentityKey } : {}),
        feeAssetSymbol: event.feeAssetSymbol,
        feeQuantity: event.feeQuantity.toFixed(),
        ...(event.quantityReduced !== undefined ? { quantityReduced: event.quantityReduced.toFixed() } : {}),
        ...(event.relatedEventId ? { relatedEventId: event.relatedEventId } : {}),
      };
    case 'superficial-loss-adjustment':
      return {
        ...base,
        kind: event.kind,
        deniedLossCad: event.deniedLossCad.toFixed(),
        deniedQuantity: event.deniedQuantity.toFixed(),
        relatedDispositionEventId: event.relatedDispositionEventId,
      };
  }
}

function fromStoredCanadaInputEvent(event: z.infer<typeof StoredCanadaInputEventSchema>): CanadaTaxInputEvent {
  const base = fromStoredCanadaInputEventBase(event);

  switch (event.kind) {
    case 'acquisition':
      return {
        ...base,
        kind: event.kind,
        quantity: parseDecimal(event.quantity),
        ...(event.costBasisAdjustmentCad !== undefined
          ? { costBasisAdjustmentCad: parseDecimal(event.costBasisAdjustmentCad) }
          : {}),
        ...(event.incomeCategory !== undefined ? { incomeCategory: event.incomeCategory } : {}),
      };
    case 'disposition':
      return {
        ...base,
        kind: event.kind,
        quantity: parseDecimal(event.quantity),
        ...(event.proceedsReductionCad !== undefined
          ? { proceedsReductionCad: parseDecimal(event.proceedsReductionCad) }
          : {}),
      };
    case 'transfer-in':
    case 'transfer-out':
      return {
        ...base,
        kind: event.kind,
        quantity: parseDecimal(event.quantity),
      };
    case 'fee-adjustment':
      return {
        ...base,
        kind: event.kind,
        adjustmentType: event.adjustmentType,
        feeAssetId: event.feeAssetId,
        ...(event.feeAssetIdentityKey ? { feeAssetIdentityKey: event.feeAssetIdentityKey } : {}),
        feeAssetSymbol: event.feeAssetSymbol as Currency,
        feeQuantity: parseDecimal(event.feeQuantity),
        ...(event.quantityReduced !== undefined ? { quantityReduced: parseDecimal(event.quantityReduced) } : {}),
        ...(event.relatedEventId ? { relatedEventId: event.relatedEventId } : {}),
      };
    case 'superficial-loss-adjustment':
      return {
        ...base,
        kind: event.kind,
        deniedLossCad: parseDecimal(event.deniedLossCad),
        deniedQuantity: parseDecimal(event.deniedQuantity),
        relatedDispositionEventId: event.relatedDispositionEventId,
      };
  }
}

function toStoredCanadaInputContext(
  inputContext: CanadaTaxInputContext
): z.infer<typeof StoredCanadaTaxInputContextSchema> {
  return {
    taxCurrency: inputContext.taxCurrency,
    inputTransactionIds: inputContext.inputTransactionIds,
    validatedTransferLinkIds: inputContext.validatedTransferLinkIds,
    internalTransferCarryoverSourceTransactionIds: inputContext.internalTransferCarryoverSourceTransactionIds,
    inputEvents: inputContext.inputEvents.map(toStoredCanadaInputEvent),
  };
}

function fromStoredCanadaInputContext(
  inputContext: z.infer<typeof StoredCanadaTaxInputContextSchema>
): CanadaTaxInputContext {
  return {
    taxCurrency: inputContext.taxCurrency,
    inputTransactionIds: inputContext.inputTransactionIds,
    validatedTransferLinkIds: inputContext.validatedTransferLinkIds,
    internalTransferCarryoverSourceTransactionIds: inputContext.internalTransferCarryoverSourceTransactionIds,
    inputEvents: inputContext.inputEvents.map(fromStoredCanadaInputEvent),
  };
}

function toStoredCanadaTaxReportAcquisition(
  item: CanadaTaxReportAcquisition
): z.infer<typeof StoredCanadaTaxReportAcquisitionSchema> {
  return {
    id: item.id,
    acquisitionEventId: item.acquisitionEventId,
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol,
    acquiredAt: item.acquiredAt.toISOString(),
    quantityAcquired: item.quantityAcquired.toFixed(),
    remainingQuantity: item.remainingQuantity.toFixed(),
    totalCostCad: item.totalCostCad.toFixed(),
    remainingAllocatedAcbCad: item.remainingAllocatedAcbCad.toFixed(),
    costBasisPerUnitCad: item.costBasisPerUnitCad.toFixed(),
    ...(item.incomeCategory !== undefined ? { incomeCategory: item.incomeCategory } : {}),
  };
}

function fromStoredCanadaTaxReportAcquisition(
  item: z.infer<typeof StoredCanadaTaxReportAcquisitionSchema>
): CanadaTaxReportAcquisition {
  return {
    id: item.id,
    acquisitionEventId: item.acquisitionEventId,
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol as Currency,
    acquiredAt: new Date(item.acquiredAt),
    quantityAcquired: parseDecimal(item.quantityAcquired),
    remainingQuantity: parseDecimal(item.remainingQuantity),
    totalCostCad: parseDecimal(item.totalCostCad),
    remainingAllocatedAcbCad: parseDecimal(item.remainingAllocatedAcbCad),
    costBasisPerUnitCad: parseDecimal(item.costBasisPerUnitCad),
    ...(item.incomeCategory !== undefined ? { incomeCategory: item.incomeCategory } : {}),
  };
}

function toStoredCanadaTaxReportDisposition(
  item: CanadaTaxReportDisposition
): z.infer<typeof StoredCanadaTaxReportDispositionSchema> {
  return {
    id: item.id,
    dispositionEventId: item.dispositionEventId,
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol,
    disposedAt: item.disposedAt.toISOString(),
    quantityDisposed: item.quantityDisposed.toFixed(),
    proceedsCad: item.proceedsCad.toFixed(),
    costBasisCad: item.costBasisCad.toFixed(),
    gainLossCad: item.gainLossCad.toFixed(),
    deniedLossCad: item.deniedLossCad.toFixed(),
    taxableGainLossCad: item.taxableGainLossCad.toFixed(),
    acbPerUnitCad: item.acbPerUnitCad.toFixed(),
  };
}

function fromStoredCanadaTaxReportDisposition(
  item: z.infer<typeof StoredCanadaTaxReportDispositionSchema>
): CanadaTaxReportDisposition {
  return {
    id: item.id,
    dispositionEventId: item.dispositionEventId,
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol as Currency,
    disposedAt: new Date(item.disposedAt),
    quantityDisposed: parseDecimal(item.quantityDisposed),
    proceedsCad: parseDecimal(item.proceedsCad),
    costBasisCad: parseDecimal(item.costBasisCad),
    gainLossCad: parseDecimal(item.gainLossCad),
    deniedLossCad: parseDecimal(item.deniedLossCad),
    taxableGainLossCad: parseDecimal(item.taxableGainLossCad),
    acbPerUnitCad: parseDecimal(item.acbPerUnitCad),
  };
}

function toStoredCanadaTaxReportTransfer(
  item: CanadaTaxReportTransfer
): z.infer<typeof StoredCanadaTaxReportTransferSchema> {
  return {
    id: item.id,
    direction: item.direction,
    ...(item.sourceTransferEventId ? { sourceTransferEventId: item.sourceTransferEventId } : {}),
    ...(item.targetTransferEventId ? { targetTransferEventId: item.targetTransferEventId } : {}),
    ...(item.sourceTransactionId !== undefined ? { sourceTransactionId: item.sourceTransactionId } : {}),
    ...(item.targetTransactionId !== undefined ? { targetTransactionId: item.targetTransactionId } : {}),
    ...(item.linkId !== undefined ? { linkId: item.linkId } : {}),
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol,
    transferredAt: item.transferredAt.toISOString(),
    quantity: item.quantity.toFixed(),
    carriedAcbCad: item.carriedAcbCad.toFixed(),
    carriedAcbPerUnitCad: item.carriedAcbPerUnitCad.toFixed(),
    feeAdjustmentCad: item.feeAdjustmentCad.toFixed(),
  };
}

function fromStoredCanadaTaxReportTransfer(
  item: z.infer<typeof StoredCanadaTaxReportTransferSchema>
): CanadaTaxReportTransfer {
  return {
    id: item.id,
    direction: item.direction,
    ...(item.sourceTransferEventId ? { sourceTransferEventId: item.sourceTransferEventId } : {}),
    ...(item.targetTransferEventId ? { targetTransferEventId: item.targetTransferEventId } : {}),
    ...(item.sourceTransactionId !== undefined ? { sourceTransactionId: item.sourceTransactionId } : {}),
    ...(item.targetTransactionId !== undefined ? { targetTransactionId: item.targetTransactionId } : {}),
    ...(item.linkId !== undefined ? { linkId: item.linkId } : {}),
    transactionId: item.transactionId,
    taxPropertyKey: item.taxPropertyKey,
    assetSymbol: item.assetSymbol as Currency,
    transferredAt: new Date(item.transferredAt),
    quantity: parseDecimal(item.quantity),
    carriedAcbCad: parseDecimal(item.carriedAcbCad),
    carriedAcbPerUnitCad: parseDecimal(item.carriedAcbPerUnitCad),
    feeAdjustmentCad: parseDecimal(item.feeAdjustmentCad),
  };
}

function toStoredCanadaSuperficialLossAdjustment(
  item: CanadaSuperficialLossAdjustment
): z.infer<typeof StoredCanadaSuperficialLossAdjustmentSchema> {
  return {
    id: item.id,
    adjustedAt: item.adjustedAt.toISOString(),
    assetSymbol: item.assetSymbol,
    deniedLossCad: item.deniedLossCad.toFixed(),
    deniedQuantity: item.deniedQuantity.toFixed(),
    relatedDispositionId: item.relatedDispositionId,
    taxPropertyKey: item.taxPropertyKey,
    substitutedPropertyAcquisitionId: item.substitutedPropertyAcquisitionId,
  };
}

function fromStoredCanadaSuperficialLossAdjustment(
  item: z.infer<typeof StoredCanadaSuperficialLossAdjustmentSchema>
): CanadaSuperficialLossAdjustment {
  return {
    id: item.id,
    adjustedAt: new Date(item.adjustedAt),
    assetSymbol: item.assetSymbol as Currency,
    deniedLossCad: parseDecimal(item.deniedLossCad),
    deniedQuantity: parseDecimal(item.deniedQuantity),
    relatedDispositionId: item.relatedDispositionId,
    taxPropertyKey: item.taxPropertyKey,
    substitutedPropertyAcquisitionId: item.substitutedPropertyAcquisitionId,
  };
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
