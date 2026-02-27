import type { Decimal } from 'decimal.js';

import type { JurisdictionConfig } from '../types.js';

import type { IJurisdictionRules } from './base-rules.js';

/**
 * United States tax rules
 *
 * Key characteristics:
 * - Short-term gains (<1 year): Taxed as ordinary income
 * - Long-term gains (≥1 year): Preferential tax rates (0%, 15%, 20%)
 * - 100% of gains are taxable (no inclusion rate like Canada)
 * - Wash sale rules: Loss disallowed if same asset repurchased within 30 days after
 * - Transfer fees are treated as disposals, triggering capital gains/losses
 */
export class USRules implements IJurisdictionRules {
  /**
   * Jurisdiction configuration
   */
  private readonly config: JurisdictionConfig = {
    code: 'US',
    sameAssetTransferFeePolicy: 'disposal',
  };

  /**
   * Long-term holding period threshold: 365 days (1 year)
   */
  private readonly longTermThresholdDays = 365;

  /**
   * Wash sale window: 30 days after disposal
   */
  private readonly washSaleWindowDays = 30;

  getConfig(): JurisdictionConfig {
    return this.config;
  }

  getJurisdiction(): string {
    return this.config.code;
  }

  classifyGain(holdingPeriodDays: number): string {
    // Short-term: held less than 1 year
    // Long-term: held 1 year or more
    return holdingPeriodDays >= this.longTermThresholdDays ? 'long_term' : 'short_term';
  }

  calculateTaxableGain(gain: Decimal, _holdingPeriodDays: number): Decimal {
    // 100% of capital gains are taxable in the US
    // (rates differ by short-term vs long-term classification)
    return gain;
  }

  isLossDisallowed(disposalDate: Date, reacquisitionDates: Date[]): boolean {
    // Wash sale: repurchase within 30 days after disposal (not before)
    const windowEnd = new Date(disposalDate);
    windowEnd.setDate(windowEnd.getDate() + this.washSaleWindowDays);

    return reacquisitionDates.some((reacqDate) => reacqDate > disposalDate && reacqDate <= windowEnd);
  }

  getLongTermHoldingPeriodDays(): number {
    return this.longTermThresholdDays;
  }
}
