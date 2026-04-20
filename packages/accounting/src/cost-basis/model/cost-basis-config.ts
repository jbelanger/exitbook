/**
 * Supported fiat currencies for cost basis calculations
 * These align with major tax jurisdictions
 */
export type FiatCurrency = 'USD' | 'CAD' | 'EUR' | 'GBP';
export type CostBasisMethod = 'fifo' | 'lifo' | 'specific-id' | 'average-cost';
export type CostBasisJurisdiction = 'CA' | 'US' | 'UK' | 'EU';
export type SpecificLotSelectionStrategy = 'minimize-gain' | 'maximize-loss';

/**
 * Cost basis calculation configuration
 */
export interface CostBasisConfig {
  /** Calculation method */
  method: CostBasisMethod;

  /** Currency for cost basis (fiat currency code) */
  currency: FiatCurrency;

  /** Tax jurisdiction */
  jurisdiction: CostBasisJurisdiction;

  /** Tax year for the calculation */
  taxYear: number;

  /** Optional start date (defaults to start of tax year) */
  startDate?: Date | undefined;

  /** Optional end date (defaults to end of tax year) */
  endDate?: Date | undefined;

  /** Strategy for specific-id lot selection */
  specificLotSelectionStrategy?: SpecificLotSelectionStrategy | undefined;
}

/**
 * Get default date range for a tax year based on jurisdiction
 */
export function getDefaultDateRange(
  taxYear: number,
  jurisdiction: CostBasisJurisdiction
): { endDate: Date; startDate: Date } {
  switch (jurisdiction) {
    case 'CA': // Canada: January 1 - December 31
    case 'UK': // UK: April 6 - April 5 (simplified to calendar year for now)
    case 'EU': // EU: Calendar year (varies by country)
    case 'US': {
      // US: January 1 - December 31
      return {
        endDate: new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999)),
        startDate: new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0, 0)),
      };
    }
  }
}
