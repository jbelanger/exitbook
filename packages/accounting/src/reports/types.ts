/**
 * Types for cost basis report generation with display currency conversion
 */

import type { Decimal } from 'decimal.js';

import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';

/**
 * FX conversion metadata for audit trail
 */
export interface FxConversionMetadata {
  /** Original currency (always USD for storage) */
  originalCurrency: string;
  /** Display currency (CAD, EUR, GBP, etc.) */
  displayCurrency: string;
  /** FX rate used for conversion */
  fxRate: Decimal;
  /** Source of the FX rate */
  fxSource: string;
  /** When the FX rate was fetched */
  fxFetchedAt: Date;
}

/**
 * Lot disposal with amounts converted to display currency
 */
export interface ConvertedLotDisposal extends LotDisposal {
  /** Converted proceeds per unit in display currency */
  displayProceedsPerUnit: Decimal;
  /** Converted total proceeds in display currency */
  displayTotalProceeds: Decimal;
  /** Converted cost basis per unit in display currency */
  displayCostBasisPerUnit: Decimal;
  /** Converted total cost basis in display currency */
  displayTotalCostBasis: Decimal;
  /** Converted gain/loss in display currency */
  displayGainLoss: Decimal;
  /** FX conversion metadata for audit trail */
  fxConversion: FxConversionMetadata;
}

/**
 * Acquisition lot with amounts converted to display currency
 */
export interface ConvertedAcquisitionLot extends AcquisitionLot {
  /** Converted cost basis per unit in display currency */
  displayCostBasisPerUnit: Decimal;
  /** Converted total cost basis in display currency */
  displayTotalCostBasis: Decimal;
  /** FX conversion metadata for audit trail */
  fxConversion: FxConversionMetadata;
  /** True if FX rate was unavailable (USD fallback used) */
  fxUnavailable?: true | undefined;
  /** Original currency when fxUnavailable (always 'USD') */
  originalCurrency?: string | undefined;
}

/**
 * Lot transfer with amounts converted to display currency
 */
export interface ConvertedLotTransfer extends LotTransfer {
  /** Converted cost basis per unit in display currency */
  displayCostBasisPerUnit: Decimal;
  /** Converted total cost basis in display currency */
  displayTotalCostBasis: Decimal;
  /** FX conversion metadata for audit trail */
  fxConversion: FxConversionMetadata;
  /** True if FX rate was unavailable (USD fallback used) */
  fxUnavailable?: true | undefined;
  /** Original currency when fxUnavailable (always 'USD') */
  originalCurrency?: string | undefined;
}

/**
 * Cost basis report with display currency conversion
 */
export interface CostBasisReport {
  /** Calculation ID */
  calculationId: string;
  /** Display currency used for conversion */
  displayCurrency: string;
  /** Original currency (always USD) */
  originalCurrency: string;
  /** All disposals with converted amounts */
  disposals: ConvertedLotDisposal[];
  /** All lots with converted amounts */
  lots: ConvertedAcquisitionLot[];
  /** All lot transfers with converted amounts */
  lotTransfers: ConvertedLotTransfer[];
  /** Summary totals in display currency */
  summary: {
    totalCostBasis: Decimal;
    totalGainLoss: Decimal;
    totalProceeds: Decimal;
    totalTaxableGainLoss: Decimal;
  };
  /** Summary totals in original currency (USD) */
  originalSummary: {
    totalCostBasis: Decimal;
    totalGainLoss: Decimal;
    totalProceeds: Decimal;
    totalTaxableGainLoss: Decimal;
  };
}
