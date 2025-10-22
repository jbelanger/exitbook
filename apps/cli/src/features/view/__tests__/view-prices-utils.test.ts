import { describe, expect, it } from 'vitest';

import type { PriceCoverageInfo, ViewPricesResult } from '../view-prices-utils.ts';
import {
  formatCoveragePercentage,
  formatPriceCoverageForDisplay,
  formatPriceCoverageListForDisplay,
} from '../view-prices-utils.ts';

describe('view-prices-utils', () => {
  describe('formatCoveragePercentage', () => {
    it('should format percentage with one decimal place', () => {
      expect(formatCoveragePercentage(66.666)).toBe('66.7%');
      expect(formatCoveragePercentage(100)).toBe('100.0%');
      expect(formatCoveragePercentage(0)).toBe('0.0%');
      expect(formatCoveragePercentage(50.5)).toBe('50.5%');
    });
  });

  describe('formatPriceCoverageForDisplay', () => {
    it('should format coverage with checkmark icon when 100%', () => {
      const coverage: PriceCoverageInfo = {
        asset: 'BTC',
        total_transactions: 10,
        with_price: 10,
        missing_price: 0,
        coverage_percentage: 100,
      };

      const output = formatPriceCoverageForDisplay(coverage);

      expect(output).toContain('✓ BTC');
      expect(output).toContain('Total: 10 transactions');
      expect(output).toContain('With price: 10');
      expect(output).toContain('Missing: 0');
      expect(output).toContain('Coverage: 100.0%');
    });

    it('should format coverage with warning icon when missing prices', () => {
      const coverage: PriceCoverageInfo = {
        asset: 'ETH',
        total_transactions: 10,
        with_price: 7,
        missing_price: 3,
        coverage_percentage: 70,
      };

      const output = formatPriceCoverageForDisplay(coverage);

      expect(output).toContain('⚠ ETH');
      expect(output).toContain('Total: 10 transactions');
      expect(output).toContain('With price: 7');
      expect(output).toContain('Missing: 3');
      expect(output).toContain('Coverage: 70.0%');
    });

    it('should format coverage with dot icon when 0 missing but not 100%', () => {
      const coverage: PriceCoverageInfo = {
        asset: 'SOL',
        total_transactions: 5,
        with_price: 5,
        missing_price: 0,
        coverage_percentage: 100,
      };

      const output = formatPriceCoverageForDisplay(coverage);

      expect(output).toContain('✓ SOL');
      expect(output).toContain('Coverage: 100.0%');
    });
  });

  describe('formatPriceCoverageListForDisplay', () => {
    it('should format full price coverage list with summary', () => {
      const result: ViewPricesResult = {
        coverage: [
          {
            asset: 'BTC',
            total_transactions: 10,
            with_price: 8,
            missing_price: 2,
            coverage_percentage: 80,
          },
          {
            asset: 'ETH',
            total_transactions: 5,
            with_price: 5,
            missing_price: 0,
            coverage_percentage: 100,
          },
        ],
        summary: {
          total_transactions: 15,
          with_price: 13,
          missing_price: 2,
          overall_coverage_percentage: 86.67,
        },
      };

      const output = formatPriceCoverageListForDisplay(result);

      expect(output).toContain('Price Coverage by Asset:');
      expect(output).toContain('⚠ BTC');
      expect(output).toContain('✓ ETH');
      expect(output).toContain('Summary:');
      expect(output).toContain('Total transactions: 15');
      expect(output).toContain('With price: 13');
      expect(output).toContain('Missing price: 2');
      expect(output).toContain('Overall coverage: 86.7%');
    });

    it('should show message when no data found', () => {
      const result: ViewPricesResult = {
        coverage: [],
        summary: {
          total_transactions: 0,
          with_price: 0,
          missing_price: 0,
          overall_coverage_percentage: 0,
        },
      };

      const output = formatPriceCoverageListForDisplay(result);

      expect(output).toContain('No transaction data found.');
      expect(output).toContain('Total transactions: 0');
    });

    it('should handle single asset coverage', () => {
      const result: ViewPricesResult = {
        coverage: [
          {
            asset: 'BTC',
            total_transactions: 100,
            with_price: 95,
            missing_price: 5,
            coverage_percentage: 95,
          },
        ],
        summary: {
          total_transactions: 100,
          with_price: 95,
          missing_price: 5,
          overall_coverage_percentage: 95,
        },
      };

      const output = formatPriceCoverageListForDisplay(result);

      expect(output).toContain('⚠ BTC');
      expect(output).toContain('Missing: 5');
      expect(output).toContain('Coverage: 95.0%');
      expect(output).toContain('Overall coverage: 95.0%');
    });
  });
});
