import { z } from 'zod';

import {
  StoredCanadaCostBasisArtifactSchema,
  StoredCanadaDebugSchema,
} from '../jurisdictions/canada/artifacts/canada-artifact-codec.js';

import {
  DecimalStringSchema,
  IsoDateTimeStringSchema,
  StoredCostBasisExecutionMetaSchema,
  type CostBasisArtifactDebugPayload,
} from './artifact-storage-shared.js';

export { StoredCanadaCostBasisArtifactSchema };
export type { CostBasisArtifactDebugPayload };

export const StoredCostBasisConfigSchema = z.object({
  method: z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']),
  jurisdiction: z.enum(['CA', 'US', 'UK', 'EU']),
  taxYear: z.number().int().min(2000).max(2100),
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  specificLotSelectionStrategy: z.enum(['minimize-gain', 'maximize-loss']).optional(),
  taxAssetIdentityPolicy: z.enum(['strict-onchain-tokens', 'relaxed-stablecoin-symbols']).optional(),
});

export const StoredCostBasisCalculationSchema = z.object({
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

export const StoredAcquisitionLotSchema = z.object({
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

export const StoredLotDisposalSchema = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  disposalTransactionId: z.number().int().positive(),
  quantityDisposed: DecimalStringSchema,
  proceedsPerUnit: DecimalStringSchema,
  totalProceeds: DecimalStringSchema,
  grossProceeds: DecimalStringSchema,
  sellingExpenses: DecimalStringSchema,
  netProceeds: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  gainLoss: DecimalStringSchema,
  disposalDate: IsoDateTimeStringSchema,
  holdingPeriodDays: z.number().int().nonnegative(),
  lossDisallowed: z.boolean().optional(),
  disallowedLossAmount: DecimalStringSchema.optional(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
});

export const StoredLotTransferMetadataSchema = z
  .object({
    sameAssetFeeUsdValue: DecimalStringSchema.optional(),
  })
  .optional();

export const StoredLotTransferProvenanceSchema = z.discriminatedUnion('kind', [
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

export const StoredLotTransferSchema = z.object({
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

export const StoredFxConversionSchema = z.object({
  originalCurrency: z.string().min(1),
  displayCurrency: z.string().min(1),
  fxRate: DecimalStringSchema,
  fxSource: z.string().min(1),
  fxFetchedAt: IsoDateTimeStringSchema,
});

export const StoredConvertedAcquisitionLotSchema = StoredAcquisitionLotSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

export const StoredConvertedLotDisposalSchema = StoredLotDisposalSchema.extend({
  displayProceedsPerUnit: DecimalStringSchema,
  displayTotalProceeds: DecimalStringSchema,
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  displayGainLoss: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
});

export const StoredConvertedLotTransferSchema = StoredLotTransferSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

export const StoredCostBasisReportSchema = z.object({
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

export const StoredStandardDebugSchema = z.object({
  kind: z.literal('standard-workflow'),
  scopedTransactionIds: z.array(z.number().int().positive()),
  appliedConfirmedLinkIds: z.array(z.number().int().positive()),
});

export const StoredCostBasisDebugSchema = z.discriminatedUnion('kind', [
  StoredStandardDebugSchema,
  StoredCanadaDebugSchema,
]);

export const StoredArtifactEnvelopeBaseSchema = z.object({
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

export type StoredCostBasisConfig = z.infer<typeof StoredCostBasisConfigSchema>;
export type StoredCostBasisCalculation = z.infer<typeof StoredCostBasisCalculationSchema>;
export type StoredAcquisitionLot = z.infer<typeof StoredAcquisitionLotSchema>;
export type StoredLotDisposal = z.infer<typeof StoredLotDisposalSchema>;
export type StoredLotTransfer = z.infer<typeof StoredLotTransferSchema>;
export type StoredFxConversion = z.infer<typeof StoredFxConversionSchema>;
export type StoredCostBasisReport = z.infer<typeof StoredCostBasisReportSchema>;
export type StoredStandardArtifact = z.infer<typeof StoredStandardCostBasisArtifactSchema>;
export type StoredStandardDebug = z.infer<typeof StoredStandardDebugSchema>;
export type StoredCostBasisDebug = z.infer<typeof StoredCostBasisDebugSchema>;
export type StoredArtifactEnvelope = z.infer<typeof StoredCostBasisArtifactEnvelopeSchema>;
