import { CurrencySchema, DateSchema, DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

/**
 * Zod schemas for validation and parsing
 */

const CostBasisMethodSchema = z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']);

const FiatCurrencySchema = z.enum(['USD', 'CAD', 'EUR', 'GBP']);

const JurisdictionSchema = z.enum(['CA', 'US', 'UK', 'EU']);

const SameAssetTransferFeePolicySchema = z.enum(['disposal', 'add-to-basis']);

export const CostBasisMethodSupportSchema = z.object({
  code: CostBasisMethodSchema,
  description: z.string().min(1),
  implemented: z.boolean(),
  label: z.string().min(1),
});

const VarianceToleranceSchema = z.object({
  warn: z.number().nonnegative(),
  error: z.number().nonnegative(),
});

export const JurisdictionConfigSchema = z.object({
  code: JurisdictionSchema,
  label: z.string().min(1),
  defaultCurrency: FiatCurrencySchema,
  costBasisImplemented: z.boolean(),
  supportedMethods: z.array(CostBasisMethodSupportSchema).min(1),
  defaultMethod: CostBasisMethodSchema.optional(),
  sameAssetTransferFeePolicy: SameAssetTransferFeePolicySchema,
  varianceTolerance: VarianceToleranceSchema.optional(),
});

const LotStatusSchema = z.enum(['open', 'partially_disposed', 'fully_disposed']);

const CalculationStatusSchema = z.enum(['pending', 'completed', 'failed']);

const CostBasisConfigSchema = z.object({
  method: CostBasisMethodSchema,
  currency: FiatCurrencySchema,
  jurisdiction: JurisdictionSchema,
  taxYear: z.number().int().min(2000).max(2100),
  startDate: DateSchema.optional(),
  endDate: DateSchema.optional(),
  specificLotSelectionStrategy: z.enum(['minimize-gain', 'maximize-loss']).optional(),
});

export const AcquisitionLotSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  acquisitionTransactionId: z.number().int().positive(),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  quantity: DecimalSchema,
  costBasisPerUnit: DecimalSchema,
  totalCostBasis: DecimalSchema,
  acquisitionDate: DateSchema,
  method: CostBasisMethodSchema,
  remainingQuantity: DecimalSchema,
  status: LotStatusSchema,
  createdAt: DateSchema,
  updatedAt: DateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const LotDisposalSchema = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  disposalTransactionId: z.number().int().positive(),
  quantityDisposed: DecimalSchema,
  proceedsPerUnit: DecimalSchema,
  totalProceeds: DecimalSchema,
  grossProceeds: DecimalSchema,
  sellingExpenses: DecimalSchema,
  netProceeds: DecimalSchema,
  costBasisPerUnit: DecimalSchema,
  totalCostBasis: DecimalSchema,
  gainLoss: DecimalSchema,
  disposalDate: DateSchema,
  holdingPeriodDays: z.number().int().nonnegative(),
  lossDisallowed: z.boolean().optional(),
  disallowedLossAmount: DecimalSchema.optional(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: DateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const LotTransferMetadataSchema = z.object({
  sameAssetFeeUsdValue: DecimalSchema.optional(),
});

const ConfirmedLinkTransferProvenanceSchema = z.object({
  kind: z.literal('confirmed-link'),
  linkId: z.number().int().positive(),
  sourceMovementFingerprint: z.string().min(1),
  targetMovementFingerprint: z.string().min(1),
});

const InternalTransferCarryoverTransferProvenanceSchema = z.object({
  kind: z.literal('internal-transfer-carryover'),
  sourceMovementFingerprint: z.string().min(1),
  targetMovementFingerprint: z.string().min(1),
});

const LotTransferProvenanceSchema = z.discriminatedUnion('kind', [
  ConfirmedLinkTransferProvenanceSchema,
  InternalTransferCarryoverTransferProvenanceSchema,
]);

export const LotTransferSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  sourceLotId: z.string().uuid(),
  provenance: LotTransferProvenanceSchema,
  quantityTransferred: DecimalSchema,
  costBasisPerUnit: DecimalSchema,
  sourceTransactionId: z.number().int().positive(),
  targetTransactionId: z.number().int().positive(),
  transferDate: DateSchema,
  createdAt: DateSchema,
  metadata: LotTransferMetadataSchema.optional(),
});

export const CostBasisCalculationSchema = z.object({
  id: z.string().uuid(),
  calculationDate: DateSchema,
  config: CostBasisConfigSchema,
  startDate: DateSchema.optional(),
  endDate: DateSchema.optional(),
  totalProceeds: DecimalSchema,
  totalCostBasis: DecimalSchema,
  totalGainLoss: DecimalSchema,
  totalTaxableGainLoss: DecimalSchema,
  assetsProcessed: z.array(z.string()),
  transactionsProcessed: z.number().int().nonnegative(),
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  status: CalculationStatusSchema,
  errorMessage: z.string().optional(),
  createdAt: DateSchema,
  completedAt: DateSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Type exports inferred from schemas
 */
export type AcquisitionLot = z.infer<typeof AcquisitionLotSchema>;
export type LotDisposal = z.infer<typeof LotDisposalSchema>;
export type LotTransfer = z.infer<typeof LotTransferSchema>;
export type CostBasisCalculation = z.infer<typeof CostBasisCalculationSchema>;
export type CostBasisMethodSupport = z.infer<typeof CostBasisMethodSupportSchema>;
export type JurisdictionConfig = z.infer<typeof JurisdictionConfigSchema>;
