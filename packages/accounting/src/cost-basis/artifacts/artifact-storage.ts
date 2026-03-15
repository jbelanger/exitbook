import { parseDecimal, type Currency } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { z } from 'zod';

import type { CostBasisDependencyWatermark, CostBasisSnapshotRecord } from '../../ports/cost-basis-persistence.js';
import type {
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaSuperficialLossAdjustment,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
} from '../canada/canada-tax-types.js';
import type {
  CostBasisReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  FxConversionMetadata,
} from '../model/report-types.js';
import type { AcquisitionLot, CostBasisCalculation, LotDisposal, LotTransfer } from '../model/schemas.js';
import type { CostBasisWorkflowResult } from '../workflow/cost-basis-workflow.js';

const logger = getLogger('cost-basis.artifacts.storage');

const DecimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const IsoDateTimeStringSchema = z.string().datetime({ offset: true });

const StoredCostBasisConfigSchema = z.object({
  method: z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']),
  jurisdiction: z.enum(['CA', 'US', 'UK', 'EU']),
  taxYear: z.number().int().min(2000).max(2100),
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  specificLotSelectionStrategy: z.enum(['minimize-gain', 'maximize-loss']).optional(),
  taxAssetIdentityPolicy: z.enum(['strict-onchain-tokens', 'relaxed-stablecoin-symbols']).optional(),
});

const StoredCostBasisCalculationSchema = z.object({
  id: z.string().uuid(),
  calculationDate: IsoDateTimeStringSchema,
  config: StoredCostBasisConfigSchema,
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  totalProceeds: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  totalGainLoss: DecimalStringSchema,
  totalTaxableGainLoss: DecimalStringSchema,
  assetsProcessed: z.array(z.string().min(1)),
  transactionsProcessed: z.number().int().nonnegative(),
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  status: z.enum(['pending', 'completed', 'failed']),
  errorMessage: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
  completedAt: IsoDateTimeStringSchema.optional(),
});

const StoredAcquisitionLotSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  acquisitionTransactionId: z.number().int().positive(),
  assetId: z.string().min(1),
  assetSymbol: z.string().min(1),
  quantity: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  acquisitionDate: IsoDateTimeStringSchema,
  method: z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']),
  remainingQuantity: DecimalStringSchema,
  status: z.enum(['open', 'partially_disposed', 'fully_disposed']),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});

const StoredLotDisposalSchema = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  disposalTransactionId: z.number().int().positive(),
  quantityDisposed: DecimalStringSchema,
  proceedsPerUnit: DecimalStringSchema,
  totalProceeds: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  gainLoss: DecimalStringSchema,
  disposalDate: IsoDateTimeStringSchema,
  holdingPeriodDays: z.number().int().nonnegative(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
});

const StoredLotTransferMetadataSchema = z
  .object({
    sameAssetFeeUsdValue: DecimalStringSchema.optional(),
  })
  .optional();

const StoredLotTransferProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('confirmed-link'),
    linkId: z.number().int().positive(),
    sourceMovementFingerprint: z.string().min(1),
    targetMovementFingerprint: z.string().min(1),
  }),
  z.object({
    kind: z.literal('fee-only-carryover'),
    sourceMovementFingerprint: z.string().min(1),
    targetMovementFingerprint: z.string().min(1),
  }),
]);

const StoredLotTransferSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  sourceLotId: z.string().uuid(),
  provenance: StoredLotTransferProvenanceSchema,
  quantityTransferred: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  sourceTransactionId: z.number().int().positive(),
  targetTransactionId: z.number().int().positive(),
  transferDate: IsoDateTimeStringSchema,
  createdAt: IsoDateTimeStringSchema,
  metadata: StoredLotTransferMetadataSchema,
});

const StoredFxConversionSchema = z.object({
  originalCurrency: z.string().min(1),
  displayCurrency: z.string().min(1),
  fxRate: DecimalStringSchema,
  fxSource: z.string().min(1),
  fxFetchedAt: IsoDateTimeStringSchema,
});

const StoredConvertedAcquisitionLotSchema = StoredAcquisitionLotSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

const StoredConvertedLotDisposalSchema = StoredLotDisposalSchema.extend({
  displayProceedsPerUnit: DecimalStringSchema,
  displayTotalProceeds: DecimalStringSchema,
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  displayGainLoss: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
});

const StoredConvertedLotTransferSchema = StoredLotTransferSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

const StoredCostBasisReportSchema = z.object({
  calculationId: z.string().uuid(),
  displayCurrency: z.string().min(1),
  originalCurrency: z.string().min(1),
  disposals: z.array(StoredConvertedLotDisposalSchema),
  lots: z.array(StoredConvertedAcquisitionLotSchema),
  lotTransfers: z.array(StoredConvertedLotTransferSchema),
  summary: z.object({
    totalCostBasis: DecimalStringSchema,
    totalGainLoss: DecimalStringSchema,
    totalProceeds: DecimalStringSchema,
    totalTaxableGainLoss: DecimalStringSchema,
  }),
  originalSummary: z.object({
    totalCostBasis: DecimalStringSchema,
    totalGainLoss: DecimalStringSchema,
    totalProceeds: DecimalStringSchema,
    totalTaxableGainLoss: DecimalStringSchema,
  }),
});

const StoredCostBasisExecutionMetaSchema = z.object({
  missingPricesCount: z.number().int().nonnegative(),
  retainedTransactionIds: z.array(z.number().int().positive()),
});

export const StoredStandardCostBasisArtifactSchema = z.object({
  kind: z.literal('standard-workflow'),
  calculation: StoredCostBasisCalculationSchema,
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  totalCapitalGainLoss: DecimalStringSchema,
  totalTaxableGainLoss: DecimalStringSchema,
  assetsProcessed: z.array(z.string().min(1)),
  lots: z.array(StoredAcquisitionLotSchema),
  disposals: z.array(StoredLotDisposalSchema),
  lotTransfers: z.array(StoredLotTransferSchema),
  executionMeta: StoredCostBasisExecutionMetaSchema,
  report: StoredCostBasisReportSchema.optional(),
});

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
  displayReport: StoredCanadaDisplayCostBasisReportSchema,
  executionMeta: StoredCostBasisExecutionMetaSchema,
});

const StoredStandardDebugSchema = z.object({
  kind: z.literal('standard-workflow'),
  scopedTransactionIds: z.array(z.number().int().positive()),
  appliedConfirmedLinkIds: z.array(z.number().int().positive()),
});

const StoredCanadaDebugSchema = z.object({
  kind: z.literal('canada-workflow'),
  scopedTransactionIds: z.array(z.number().int().positive()),
  appliedConfirmedLinkIds: z.array(z.number().int().positive()),
  acquisitionEventIds: z.array(z.string().min(1)),
  dispositionEventIds: z.array(z.string().min(1)),
  transferIds: z.array(z.string().min(1)),
  superficialLossAdjustmentIds: z.array(z.string().min(1)),
});

export const StoredCostBasisDebugSchema = z.discriminatedUnion('kind', [
  StoredStandardDebugSchema,
  StoredCanadaDebugSchema,
]);

const StoredArtifactEnvelopeBaseSchema = z.object({
  storageSchemaVersion: z.number().int().positive(),
  calculationEngineVersion: z.number().int().positive(),
  scopeKey: z.string().min(1),
  snapshotId: z.string().uuid(),
  calculationId: z.string().min(1),
  createdAt: IsoDateTimeStringSchema,
});

export const StoredCostBasisArtifactEnvelopeSchema = z.discriminatedUnion('artifactKind', [
  StoredArtifactEnvelopeBaseSchema.extend({
    artifactKind: z.literal('standard'),
    artifact: StoredStandardCostBasisArtifactSchema,
    debug: StoredStandardDebugSchema,
  }),
  StoredArtifactEnvelopeBaseSchema.extend({
    artifactKind: z.literal('canada'),
    artifact: StoredCanadaCostBasisArtifactSchema,
    debug: StoredCanadaDebugSchema,
  }),
]);

type StoredStandardArtifact = z.infer<typeof StoredStandardCostBasisArtifactSchema>;
type StoredCanadaArtifact = z.infer<typeof StoredCanadaCostBasisArtifactSchema>;
type StoredCostBasisDebug = z.infer<typeof StoredCostBasisDebugSchema>;
type StoredArtifactEnvelope = z.infer<typeof StoredCostBasisArtifactEnvelopeSchema>;

export interface CostBasisArtifactDebugPayload {
  kind: 'standard-workflow' | 'canada-workflow';
  scopedTransactionIds: number[];
  appliedConfirmedLinkIds: number[];
  acquisitionEventIds?: string[] | undefined;
  dispositionEventIds?: string[] | undefined;
  transferIds?: string[] | undefined;
  superficialLossAdjustmentIds?: string[] | undefined;
}

interface CostBasisSnapshotBuildResult {
  artifact: CostBasisWorkflowResult;
  debug: CostBasisArtifactDebugPayload;
  snapshot: CostBasisSnapshotRecord;
  scopeKey: string;
  snapshotId: string;
}

interface CostBasisArtifactReuseResult {
  artifact: CostBasisWorkflowResult;
  debug: CostBasisArtifactDebugPayload;
  snapshotId: string;
}

interface CostBasisArtifactFreshnessResult {
  status: 'fresh' | 'stale';
  reason?: string | undefined;
}

export const COST_BASIS_STORAGE_SCHEMA_VERSION = 2;
export const COST_BASIS_CALCULATION_ENGINE_VERSION = 1;

export function buildCostBasisScopeKey(config: {
  currency: string;
  endDate?: Date | undefined;
  jurisdiction: string;
  method: string;
  specificLotSelectionStrategy?: string | undefined;
  startDate?: Date | undefined;
  taxAssetIdentityPolicy?: string | undefined;
  taxYear: number;
}): string {
  const stableConfig = {
    currency: config.currency,
    endDate: config.endDate?.toISOString() ?? undefined,
    jurisdiction: config.jurisdiction,
    method: config.method,
    specificLotSelectionStrategy: config.specificLotSelectionStrategy ?? undefined,
    startDate: config.startDate?.toISOString() ?? undefined,
    taxAssetIdentityPolicy: config.taxAssetIdentityPolicy ?? undefined,
    taxYear: config.taxYear,
  };

  const encoded = JSON.stringify(stableConfig);
  return `cost-basis:${hashString(encoded)}`;
}

export function buildAccountingExclusionFingerprint(excludedAssetIds: ReadonlySet<string>): string {
  const sorted = [...excludedAssetIds].sort();
  if (sorted.length === 0) {
    return 'excluded-assets:none';
  }

  return `excluded-assets:${hashString(JSON.stringify(sorted))}`;
}

export function evaluateCostBasisArtifactFreshness(
  snapshot: CostBasisSnapshotRecord,
  watermark: CostBasisDependencyWatermark
): CostBasisArtifactFreshnessResult {
  if (snapshot.storageSchemaVersion !== COST_BASIS_STORAGE_SCHEMA_VERSION) {
    return { status: 'stale', reason: 'storage-schema-version-mismatch' };
  }

  if (snapshot.calculationEngineVersion !== COST_BASIS_CALCULATION_ENGINE_VERSION) {
    return { status: 'stale', reason: 'calculation-engine-version-mismatch' };
  }

  if (watermark.links.status !== 'fresh' || !watermark.links.lastBuiltAt) {
    return { status: 'stale', reason: 'links-not-fresh' };
  }

  if (watermark.assetReview.status !== 'fresh' || !watermark.assetReview.lastBuiltAt) {
    return { status: 'stale', reason: 'asset-review-not-fresh' };
  }

  if (watermark.links.lastBuiltAt.getTime() !== snapshot.linksBuiltAt.getTime()) {
    return { status: 'stale', reason: 'links-built-at-mismatch' };
  }

  if (watermark.assetReview.lastBuiltAt.getTime() !== snapshot.assetReviewBuiltAt.getTime()) {
    return { status: 'stale', reason: 'asset-review-built-at-mismatch' };
  }

  if (
    (watermark.pricesLastMutatedAt?.getTime() ?? undefined) !== (snapshot.pricesLastMutatedAt?.getTime() ?? undefined)
  ) {
    return { status: 'stale', reason: 'prices-last-mutated-at-mismatch' };
  }

  if (watermark.exclusionFingerprint !== snapshot.exclusionFingerprint) {
    return { status: 'stale', reason: 'exclusion-fingerprint-mismatch' };
  }

  return { status: 'fresh' };
}

export function buildCostBasisSnapshotRecord(
  artifact: CostBasisWorkflowResult,
  dependencyWatermark: CostBasisDependencyWatermark,
  scopeKey: string
): Result<CostBasisSnapshotBuildResult, Error> {
  if (!dependencyWatermark.links.lastBuiltAt || !dependencyWatermark.assetReview.lastBuiltAt) {
    return err(new Error('Cannot persist a cost-basis snapshot without fresh upstream projection timestamps'));
  }

  const snapshotId = globalThis.crypto.randomUUID();
  const createdAt = new Date();
  const debug = buildDebugPayload(artifact);
  let envelope: StoredArtifactEnvelope;
  let displayCurrency: string;
  let endDate: string;
  let jurisdiction: string;
  let method: string;
  let startDate: string;
  let taxYear: number;

  if (artifact.kind === 'standard-workflow') {
    const calculationWindowResult = resolveStoredCostBasisCalculationWindow(artifact.summary.calculation);
    if (calculationWindowResult.isErr()) {
      return err(calculationWindowResult.error);
    }
    const calculationWindow = calculationWindowResult.value;

    envelope = {
      artifactKind: 'standard',
      storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
      calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
      scopeKey,
      snapshotId,
      calculationId: artifact.summary.calculation.id,
      createdAt: createdAt.toISOString(),
      artifact: toStoredStandardArtifact(artifact, calculationWindow),
      debug: toStoredStandardDebug(debug),
    };
    jurisdiction = artifact.summary.calculation.config.jurisdiction;
    method = artifact.summary.calculation.config.method;
    taxYear = artifact.summary.calculation.config.taxYear;
    displayCurrency = artifact.summary.calculation.config.currency;
    startDate = calculationWindow.startDate.toISOString();
    endDate = calculationWindow.endDate.toISOString();
  } else {
    const displayReportResult = requireCanadaDisplayReport(artifact);
    if (displayReportResult.isErr()) {
      return err(displayReportResult.error);
    }
    const displayReport = displayReportResult.value;

    envelope = {
      artifactKind: 'canada',
      storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
      calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
      scopeKey,
      snapshotId,
      calculationId: artifact.calculation.id,
      createdAt: createdAt.toISOString(),
      artifact: toStoredCanadaArtifact(artifact, displayReport),
      debug: toStoredCanadaDebug(debug),
    };
    jurisdiction = artifact.calculation.jurisdiction;
    method = artifact.calculation.method;
    taxYear = artifact.calculation.taxYear;
    displayCurrency = displayReport.displayCurrency;
    startDate = artifact.calculation.startDate.toISOString();
    endDate = artifact.calculation.endDate.toISOString();
  }

  const parsedEnvelope = StoredCostBasisArtifactEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) {
    return err(new Error(`Invalid stored cost-basis artifact envelope: ${parsedEnvelope.error.message}`));
  }

  const snapshot: CostBasisSnapshotRecord = {
    scopeKey,
    snapshotId,
    storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
    calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
    artifactKind: envelope.artifactKind,
    linksBuiltAt: dependencyWatermark.links.lastBuiltAt,
    assetReviewBuiltAt: dependencyWatermark.assetReview.lastBuiltAt,
    ...(dependencyWatermark.pricesLastMutatedAt
      ? { pricesLastMutatedAt: dependencyWatermark.pricesLastMutatedAt }
      : {}),
    exclusionFingerprint: dependencyWatermark.exclusionFingerprint,
    calculationId: envelope.calculationId,
    jurisdiction,
    method,
    taxYear,
    displayCurrency,
    startDate,
    endDate,
    artifactJson: JSON.stringify(envelope.artifact),
    debugJson: JSON.stringify(envelope.debug),
    createdAt,
    updatedAt: createdAt,
  };

  return ok({
    artifact,
    debug,
    snapshot,
    scopeKey,
    snapshotId,
  });
}

export function readCostBasisSnapshotArtifact(
  snapshot: CostBasisSnapshotRecord
): Result<CostBasisArtifactReuseResult, Error> {
  let parsedArtifactJson: unknown;
  let parsedDebugJson: unknown;

  try {
    parsedArtifactJson = JSON.parse(snapshot.artifactJson) as unknown;
    parsedDebugJson = JSON.parse(snapshot.debugJson) as unknown;
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  const envelopeResult = StoredCostBasisArtifactEnvelopeSchema.safeParse({
    artifactKind: snapshot.artifactKind,
    storageSchemaVersion: snapshot.storageSchemaVersion,
    calculationEngineVersion: snapshot.calculationEngineVersion,
    scopeKey: snapshot.scopeKey,
    snapshotId: snapshot.snapshotId,
    calculationId: snapshot.calculationId,
    createdAt: snapshot.createdAt.toISOString(),
    artifact: parsedArtifactJson,
    debug: parsedDebugJson,
  });

  if (!envelopeResult.success) {
    logger.warn(
      { scopeKey: snapshot.scopeKey, snapshotId: snapshot.snapshotId, error: envelopeResult.error.format() },
      'Stored cost-basis snapshot could not be parsed'
    );
    return err(new Error(`Unreadable stored cost-basis artifact: ${envelopeResult.error.message}`));
  }

  const envelope = envelopeResult.data;
  const artifact =
    envelope.artifactKind === 'standard'
      ? fromStoredStandardArtifact(envelope.artifact)
      : fromStoredCanadaArtifact(envelope.artifact);
  const debug = fromStoredDebug(envelope.debug);

  return ok({
    artifact,
    debug,
    snapshotId: snapshot.snapshotId,
  });
}

function toStoredStandardArtifact(
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

function fromStoredStandardArtifact(
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

function toStoredCanadaArtifact(
  result: Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }>,
  displayReport: CanadaDisplayCostBasisReport
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
    displayReport: toStoredCanadaDisplayReport(displayReport),
    executionMeta: {
      missingPricesCount: result.executionMeta.missingPricesCount,
      retainedTransactionIds: result.executionMeta.retainedTransactionIds,
    },
  };
}

function fromStoredCanadaArtifact(
  artifact: StoredCanadaArtifact
): Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }> {
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
    displayReport: fromStoredCanadaDisplayReport(artifact.displayReport),
    executionMeta: {
      missingPricesCount: artifact.executionMeta.missingPricesCount,
      retainedTransactionIds: artifact.executionMeta.retainedTransactionIds,
    },
  };
}

function buildDebugPayload(artifact: CostBasisWorkflowResult): CostBasisArtifactDebugPayload {
  if (artifact.kind === 'standard-workflow') {
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

  const linkIds = artifact.taxReport.transfers
    .map((transfer) => transfer.linkId)
    .filter((linkId): linkId is number => typeof linkId === 'number');

  return {
    kind: 'canada-workflow',
    scopedTransactionIds: uniqueSortedNumbers([
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

function toStoredStandardDebug(debug: CostBasisArtifactDebugPayload): z.infer<typeof StoredStandardDebugSchema> {
  return {
    kind: 'standard-workflow',
    scopedTransactionIds: debug.scopedTransactionIds,
    appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
  };
}

function toStoredCanadaDebug(debug: CostBasisArtifactDebugPayload): z.infer<typeof StoredCanadaDebugSchema> {
  return {
    kind: 'canada-workflow',
    scopedTransactionIds: debug.scopedTransactionIds,
    appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
    acquisitionEventIds: debug.acquisitionEventIds ?? [],
    dispositionEventIds: debug.dispositionEventIds ?? [],
    transferIds: debug.transferIds ?? [],
    superficialLossAdjustmentIds: debug.superficialLossAdjustmentIds ?? [],
  };
}

function fromStoredDebug(debug: StoredCostBasisDebug): CostBasisArtifactDebugPayload {
  return debug.kind === 'standard-workflow'
    ? {
        kind: debug.kind,
        scopedTransactionIds: debug.scopedTransactionIds,
        appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
      }
    : {
        kind: debug.kind,
        scopedTransactionIds: debug.scopedTransactionIds,
        appliedConfirmedLinkIds: debug.appliedConfirmedLinkIds,
        acquisitionEventIds: debug.acquisitionEventIds,
        dispositionEventIds: debug.dispositionEventIds,
        transferIds: debug.transferIds,
        superficialLossAdjustmentIds: debug.superficialLossAdjustmentIds,
      };
}

function toStoredCostBasisCalculation(
  calculation: CostBasisCalculation,
  calculationWindow: { endDate: Date; startDate: Date }
): z.infer<typeof StoredCostBasisCalculationSchema> {
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
      ...(calculation.config.taxAssetIdentityPolicy
        ? { taxAssetIdentityPolicy: calculation.config.taxAssetIdentityPolicy }
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

function fromStoredCostBasisCalculation(
  calculation: z.infer<typeof StoredCostBasisCalculationSchema>
): CostBasisCalculation {
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
      ...(calculation.config.taxAssetIdentityPolicy
        ? { taxAssetIdentityPolicy: calculation.config.taxAssetIdentityPolicy }
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

function resolveStoredCostBasisCalculationWindow(
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

function requireCanadaDisplayReport(
  result: Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }>
): Result<CanadaDisplayCostBasisReport, Error> {
  if (!result.displayReport) {
    return err(
      new Error(
        `Cannot persist Canada cost-basis snapshot without a display report for calculation ${result.calculation.id}`
      )
    );
  }

  return ok(result.displayReport);
}

function toStoredAcquisitionLot(lot: AcquisitionLot): z.infer<typeof StoredAcquisitionLotSchema> {
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

function fromStoredAcquisitionLot(lot: z.infer<typeof StoredAcquisitionLotSchema>): AcquisitionLot {
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

function toStoredLotDisposal(disposal: LotDisposal): z.infer<typeof StoredLotDisposalSchema> {
  return {
    id: disposal.id,
    lotId: disposal.lotId,
    disposalTransactionId: disposal.disposalTransactionId,
    quantityDisposed: disposal.quantityDisposed.toFixed(),
    proceedsPerUnit: disposal.proceedsPerUnit.toFixed(),
    totalProceeds: disposal.totalProceeds.toFixed(),
    costBasisPerUnit: disposal.costBasisPerUnit.toFixed(),
    totalCostBasis: disposal.totalCostBasis.toFixed(),
    gainLoss: disposal.gainLoss.toFixed(),
    disposalDate: disposal.disposalDate.toISOString(),
    holdingPeriodDays: disposal.holdingPeriodDays,
    ...(disposal.taxTreatmentCategory ? { taxTreatmentCategory: disposal.taxTreatmentCategory } : {}),
    createdAt: disposal.createdAt.toISOString(),
  };
}

function fromStoredLotDisposal(disposal: z.infer<typeof StoredLotDisposalSchema>): LotDisposal {
  return {
    id: disposal.id,
    lotId: disposal.lotId,
    disposalTransactionId: disposal.disposalTransactionId,
    quantityDisposed: parseDecimal(disposal.quantityDisposed),
    proceedsPerUnit: parseDecimal(disposal.proceedsPerUnit),
    totalProceeds: parseDecimal(disposal.totalProceeds),
    costBasisPerUnit: parseDecimal(disposal.costBasisPerUnit),
    totalCostBasis: parseDecimal(disposal.totalCostBasis),
    gainLoss: parseDecimal(disposal.gainLoss),
    disposalDate: new Date(disposal.disposalDate),
    holdingPeriodDays: disposal.holdingPeriodDays,
    ...(disposal.taxTreatmentCategory ? { taxTreatmentCategory: disposal.taxTreatmentCategory } : {}),
    createdAt: new Date(disposal.createdAt),
  };
}

function toStoredLotTransfer(transfer: LotTransfer): z.infer<typeof StoredLotTransferSchema> {
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

function fromStoredLotTransfer(transfer: z.infer<typeof StoredLotTransferSchema>): LotTransfer {
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

function toStoredFxConversion(fx: FxConversionMetadata): z.infer<typeof StoredFxConversionSchema> {
  return {
    originalCurrency: fx.originalCurrency,
    displayCurrency: fx.displayCurrency,
    fxRate: fx.fxRate.toFixed(),
    fxSource: fx.fxSource,
    fxFetchedAt: fx.fxFetchedAt.toISOString(),
  };
}

function fromStoredFxConversion(fx: z.infer<typeof StoredFxConversionSchema>): FxConversionMetadata {
  return {
    originalCurrency: fx.originalCurrency,
    displayCurrency: fx.displayCurrency,
    fxRate: parseDecimal(fx.fxRate),
    fxSource: fx.fxSource,
    fxFetchedAt: new Date(fx.fxFetchedAt),
  };
}

function toStoredCostBasisReport(report: CostBasisReport): z.infer<typeof StoredCostBasisReportSchema> {
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

function fromStoredCostBasisReport(report: z.infer<typeof StoredCostBasisReportSchema>): CostBasisReport {
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
    ...(item.sourceTransactionId ? { sourceTransactionId: item.sourceTransactionId } : {}),
    ...(item.targetTransactionId ? { targetTransactionId: item.targetTransactionId } : {}),
    ...(item.linkId ? { linkId: item.linkId } : {}),
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
    ...(item.sourceTransactionId ? { sourceTransactionId: item.sourceTransactionId } : {}),
    ...(item.targetTransactionId ? { targetTransactionId: item.targetTransactionId } : {}),
    ...(item.linkId ? { linkId: item.linkId } : {}),
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
  return [...new Set(values)].sort((a, b) => a - b);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function containsOnlyPlainJson(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(containsOnlyPlainJson);
  }

  if (value instanceof Date || value instanceof Decimal || value instanceof Map) {
    return false;
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(containsOnlyPlainJson);
  }

  return false;
}
