import type { Decimal } from 'decimal.js';

import type { CostBasisConfig } from '../config/cost-basis-config.js';

/**
 * Status of an acquisition lot
 */
export type LotStatus = 'open' | 'partially_disposed' | 'fully_disposed';

/**
 * Status of a cost basis calculation
 */
export type CalculationStatus = 'pending' | 'completed' | 'failed';

/**
 * Acquisition lot - represents a purchase/acquisition of an asset
 */
export interface AcquisitionLot {
  id: string;
  calculationId: string;
  acquisitionTransactionId: number;
  asset: string; // Currency symbol (e.g., BTC, ETH, USD)
  quantity: Decimal;
  costBasisPerUnit: Decimal;
  totalCostBasis: Decimal;
  acquisitionDate: Date;
  method: CostBasisConfig['method'];
  remainingQuantity: Decimal;
  status: LotStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Lot disposal - represents a sale/disposal matched to acquisition lot(s)
 */
export interface LotDisposal {
  id: string;
  lotId: string;
  disposalTransactionId: number;
  quantityDisposed: Decimal;
  proceedsPerUnit: Decimal;
  totalProceeds: Decimal;
  costBasisPerUnit: Decimal;
  totalCostBasis: Decimal;
  gainLoss: Decimal;
  disposalDate: Date;
  holdingPeriodDays: number;
  taxTreatmentCategory: string | undefined;
  createdAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Cost basis calculation - summary of a calculation run
 */
export interface CostBasisCalculation {
  id: string;
  calculationDate: Date;
  config: CostBasisConfig;
  startDate: Date | undefined;
  endDate: Date | undefined;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  assetsProcessed: string[]; // Array of currency symbols (e.g., ['BTC', 'ETH'])
  transactionsProcessed: number;
  lotsCreated: number;
  disposalsProcessed: number;
  status: CalculationStatus;
  errorMessage: string | undefined;
  createdAt: Date;
  completedAt: Date | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Result of a cost basis calculation
 */
export interface CalculationResult {
  calculation: CostBasisCalculation;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
}
