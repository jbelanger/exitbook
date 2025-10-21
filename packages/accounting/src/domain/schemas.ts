import { DateSchema, DecimalSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Zod schemas for validation and parsing
 */

export const CostBasisMethodSchema = z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']);

export const FiatCurrencySchema = z.enum(['USD', 'CAD', 'EUR', 'GBP']);

export const JurisdictionSchema = z.enum(['CA', 'US', 'UK', 'EU']);

export const LotStatusSchema = z.enum(['open', 'partially_disposed', 'fully_disposed']);

export const CalculationStatusSchema = z.enum(['pending', 'completed', 'failed']);

export const CostBasisConfigSchema = z.object({
  method: CostBasisMethodSchema,
  currency: FiatCurrencySchema,
  jurisdiction: JurisdictionSchema,
  taxYear: z.number().int().min(2000).max(2100),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  specificLotSelectionStrategy: z.enum(['minimize-gain', 'maximize-loss']).optional(),
});

export const AcquisitionLotSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  acquisitionTransactionId: z.number().int().positive(),
  asset: z.string().min(1),
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
  costBasisPerUnit: DecimalSchema,
  totalCostBasis: DecimalSchema,
  gainLoss: DecimalSchema,
  disposalDate: DateSchema,
  holdingPeriodDays: z.number().int().nonnegative(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: DateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
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
export type CostBasisCalculation = z.infer<typeof CostBasisCalculationSchema>;
export type LotStatus = z.infer<typeof LotStatusSchema>;
export type CalculationStatus = z.infer<typeof CalculationStatusSchema>;
