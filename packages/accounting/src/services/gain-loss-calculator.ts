import type { Decimal } from 'decimal.js';

/**
 * Gain/loss summary for a single disposal
 */
export interface DisposalGainLoss {
  /** Disposal ID */
  disposalId: string;
  /** Asset symbol */
  asset: string;
  /** Disposal date */
  disposalDate: Date;
  /** Acquisition date (from lot) */
  acquisitionDate: Date;
  /** Holding period in days */
  holdingPeriodDays: number;
  /** Raw capital gain/loss */
  capitalGainLoss: Decimal;
  /** Taxable gain/loss after applying jurisdiction rules */
  taxableGainLoss: Decimal;
  /** Tax treatment category (e.g., 'short_term', 'long_term') */
  taxTreatmentCategory: string | undefined;
  /** Whether loss is disallowed due to superficial loss/wash sale */
  lossDisallowed: boolean;
  /** Quantity disposed */
  quantityDisposed: Decimal;
  /** Proceeds per unit */
  proceedsPerUnit: Decimal;
  /** Cost basis per unit */
  costBasisPerUnit: Decimal;
}

/**
 * Gain/loss summary for a single asset
 */
export interface AssetGainLossSummary {
  /** Asset symbol */
  asset: string;
  /** Total proceeds from all disposals */
  totalProceeds: Decimal;
  /** Total cost basis from all disposals */
  totalCostBasis: Decimal;
  /** Total capital gain/loss (raw) */
  totalCapitalGainLoss: Decimal;
  /** Total taxable gain/loss (after jurisdiction rules) */
  totalTaxableGainLoss: Decimal;
  /** Number of disposals */
  disposalCount: number;
  /** Breakdown by tax treatment category */
  byCategory: Map<string, { count: number; gainLoss: Decimal; taxableGainLoss: Decimal }>;
  /** Individual disposal details */
  disposals: DisposalGainLoss[];
}

/**
 * Overall gain/loss calculation result
 */
export interface GainLossResult {
  /** Summaries grouped by asset */
  byAsset: Map<string, AssetGainLossSummary>;
  /** Total proceeds across all assets */
  totalProceeds: Decimal;
  /** Total cost basis across all assets */
  totalCostBasis: Decimal;
  /** Total capital gain/loss across all assets */
  totalCapitalGainLoss: Decimal;
  /** Total taxable gain/loss across all assets */
  totalTaxableGainLoss: Decimal;
  /** Total number of disposals processed */
  totalDisposalsProcessed: number;
  /** Number of disallowed losses */
  disallowedLossCount: number;
}
