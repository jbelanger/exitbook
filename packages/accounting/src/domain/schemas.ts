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
  asset: z.string().min(1), // Currency symbol (e.g., BTC, ETH, USD)
  quantity: z.string(), // Decimal as string
  costBasisPerUnit: z.string(), // Decimal as string
  totalCostBasis: z.string(), // Decimal as string
  acquisitionDate: z.number().int().positive(), // Unix timestamp
  method: CostBasisMethodSchema,
  remainingQuantity: z.string(), // Decimal as string
  status: LotStatusSchema,
  createdAt: z.number().int().positive(), // Unix timestamp
  updatedAt: z.number().int().positive(), // Unix timestamp
  metadata: z.record(z.unknown()).optional(),
});

export const LotDisposalSchema = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  disposalTransactionId: z.number().int().positive(),
  quantityDisposed: z.string(), // Decimal as string
  proceedsPerUnit: z.string(), // Decimal as string
  totalProceeds: z.string(), // Decimal as string
  costBasisPerUnit: z.string(), // Decimal as string
  totalCostBasis: z.string(), // Decimal as string
  gainLoss: z.string(), // Decimal as string
  disposalDate: z.number().int().positive(), // Unix timestamp
  holdingPeriodDays: z.number().int().nonnegative(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: z.number().int().positive(), // Unix timestamp
  metadata: z.record(z.unknown()).optional(),
});

export const CostBasisCalculationSchema = z.object({
  id: z.string().uuid(),
  calculationDate: z.number().int().positive(), // Unix timestamp
  config: CostBasisConfigSchema,
  startDate: z.number().int().positive().optional(), // Unix timestamp
  endDate: z.number().int().positive().optional(), // Unix timestamp
  totalProceeds: z.string(), // Decimal as string
  totalCostBasis: z.string(), // Decimal as string
  totalGainLoss: z.string(), // Decimal as string
  totalTaxableGainLoss: z.string(), // Decimal as string
  assetsProcessed: z.array(z.string()), // Array of currency symbols (e.g., ['BTC', 'ETH'])
  transactionsProcessed: z.number().int().nonnegative(),
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  status: CalculationStatusSchema,
  errorMessage: z.string().optional(),
  createdAt: z.number().int().positive(), // Unix timestamp
  completedAt: z.number().int().positive().optional(), // Unix timestamp
  metadata: z.record(z.unknown()).optional(),
});
