import type { Decimal } from 'decimal.js';

import type { JurisdictionConfig } from '../domain/types.js';

import type { IJurisdictionRules } from './base-rules.js';

/**
 * Canada tax rules
 *
 * Key characteristics:
 * - 50% capital gains inclusion rate (only 50% of gains are taxable)
 * - No distinction between short-term and long-term gains
 * - Superficial loss rules: Loss disallowed if same asset repurchased within 30 days before OR after
 * - Transfer fees can be added to adjusted cost base (ACB), deferring taxation
 */
export class CanadaRules implements IJurisdictionRules {
  /**
   * Jurisdiction configuration
   */
  private readonly config: JurisdictionConfig = {
    code: 'CA',
    sameAssetTransferFeePolicy: 'add-to-basis',
  };

  /**
   * Capital gains inclusion rate (50% as of 2024)
   */
  private readonly inclusionRate = 0.5;

  /**
   * Superficial loss window: 30 days before and after
   */
  private readonly superficialLossWindowDays = 30;

  getConfig(): JurisdictionConfig {
    return this.config;
  }

  getJurisdiction(): string {
    return this.config.code;
  }

  classifyGain(_holdingPeriodDays: number): undefined {
    // Canada does not distinguish between short-term and long-term gains
    return undefined;
  }

  calculateTaxableGain(gain: Decimal, _holdingPeriodDays: number): Decimal {
    // Only 50% of capital gains are taxable in Canada
    return gain.mul(this.inclusionRate);
  }

  isLossDisallowed(disposalDate: Date, reacquisitionDates: Date[]): boolean {
    // Superficial loss: repurchase within 30 days before OR after disposal
    const windowStart = new Date(disposalDate);
    windowStart.setDate(windowStart.getDate() - this.superficialLossWindowDays);

    const windowEnd = new Date(disposalDate);
    windowEnd.setDate(windowEnd.getDate() + this.superficialLossWindowDays);

    return reacquisitionDates.some((reacqDate) => reacqDate >= windowStart && reacqDate <= windowEnd);
  }

  getLongTermHoldingPeriodDays(): undefined {
    // Not applicable in Canada
    return undefined;
  }
}
