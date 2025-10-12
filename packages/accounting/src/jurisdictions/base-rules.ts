import type { Decimal } from 'decimal.js';

/**
 * Jurisdiction-specific tax rules interface
 *
 * This interface allows pluggable jurisdiction-specific logic for:
 * - Gain classification (e.g., short-term vs long-term in US, none in Canada)
 * - Taxable gain calculation (e.g., 50% inclusion rate in Canada, 100% in US)
 * - Loss disallowance rules (e.g., superficial loss in Canada, wash sale in US)
 * - Holding period thresholds
 */
export interface IJurisdictionRules {
  /**
   * Get the jurisdiction code
   */
  getJurisdiction(): string;

  /**
   * Classify a capital gain for tax purposes
   * @param holdingPeriodDays - Number of days between acquisition and disposal
   * @returns Classification string (e.g., 'short_term', 'long_term') or undefined if not applicable
   */
  classifyGain(holdingPeriodDays: number): string | undefined;

  /**
   * Calculate the taxable portion of a capital gain
   * @param gain - The capital gain (can be negative for loss)
   * @param holdingPeriodDays - Number of days between acquisition and disposal
   * @returns Taxable amount (e.g., 50% of gain for Canada, 100% for US)
   */
  calculateTaxableGain(gain: Decimal, holdingPeriodDays: number): Decimal;

  /**
   * Check if a capital loss is disallowed due to superficial loss / wash sale rules
   * @param disposalDate - Date of disposal
   * @param reacquisitionDates - Dates of subsequent reacquisitions of the same asset
   * @returns true if loss is disallowed, false otherwise
   */
  isLossDisallowed(disposalDate: Date, reacquisitionDates: Date[]): boolean;

  /**
   * Get the holding period threshold for long-term capital gains classification
   * @returns Number of days, or undefined if not applicable to this jurisdiction
   */
  getLongTermHoldingPeriodDays(): number | undefined;
}
