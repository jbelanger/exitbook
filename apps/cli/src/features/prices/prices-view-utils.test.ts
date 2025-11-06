import { describe, expect, it } from 'vitest';

import {
  formatCoveragePercentage,
  formatPriceCoverageForDisplay,
  formatPriceCoverageListForDisplay,
  type PriceCoverageInfo,
  type ViewPricesResult,
} from './prices-view-utils.js';

describe('formatCoveragePercentage', () => {
  it('should format 0% correctly', () => {
    expect(formatCoveragePercentage(0)).toBe('0.0%');
  });

  it('should format 100% correctly', () => {
    expect(formatCoveragePercentage(100)).toBe('100.0%');
  });

  it('should format percentage with one decimal place', () => {
    expect(formatCoveragePercentage(75.5)).toBe('75.5%');
  });

  it('should round to one decimal place', () => {
    expect(formatCoveragePercentage(75.56)).toBe('75.6%');
    expect(formatCoveragePercentage(75.44)).toBe('75.4%');
  });

  it('should format small percentages', () => {
    expect(formatCoveragePercentage(0.1)).toBe('0.1%');
    expect(formatCoveragePercentage(0.01)).toBe('0.0%');
  });

  it('should format percentages with many decimal places', () => {
    expect(formatCoveragePercentage(75.123456)).toBe('75.1%');
    expect(formatCoveragePercentage(99.999)).toBe('100.0%');
  });

  it('should handle very small percentages', () => {
    expect(formatCoveragePercentage(0.001)).toBe('0.0%');
  });

  it('should handle percentages close to boundaries', () => {
    expect(formatCoveragePercentage(99.95)).toBe('100.0%');
    expect(formatCoveragePercentage(99.94)).toBe('99.9%');
    expect(formatCoveragePercentage(0.05)).toBe('0.1%');
    expect(formatCoveragePercentage(0.04)).toBe('0.0%');
  });
});

describe('formatPriceCoverageForDisplay', () => {
  const createCoverageInfo = (overrides: Partial<PriceCoverageInfo> = {}): PriceCoverageInfo => ({
    asset: 'BTC',
    total_transactions: 100,
    with_price: 90,
    missing_price: 10,
    coverage_percentage: 90,
    ...overrides,
  });

  it('should format complete coverage with checkmark', () => {
    const coverage = createCoverageInfo({
      coverage_percentage: 100,
      with_price: 100,
      missing_price: 0,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('✓ BTC');
    expect(result).toContain('Total: 100 transactions');
    expect(result).toContain('With price: 100');
    expect(result).toContain('Missing: 0');
    expect(result).toContain('Coverage: 100.0%');
  });

  it('should format partial coverage with warning icon', () => {
    const coverage = createCoverageInfo({
      coverage_percentage: 90,
      with_price: 90,
      missing_price: 10,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('⚠ BTC');
    expect(result).toContain('Total: 100 transactions');
    expect(result).toContain('With price: 90');
    expect(result).toContain('Missing: 10');
    expect(result).toContain('Coverage: 90.0%');
  });

  it('should format zero missing with bullet icon', () => {
    const coverage = createCoverageInfo({
      coverage_percentage: 99,
      with_price: 99,
      missing_price: 0,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('• BTC');
    expect(result).toContain('Missing: 0');
    expect(result).toContain('Coverage: 99.0%');
  });

  it('should format asset name correctly', () => {
    const coverage = createCoverageInfo({ asset: 'ETH' });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('⚠ ETH');
  });

  it('should format different transaction counts', () => {
    const coverage = createCoverageInfo({
      total_transactions: 5000,
      with_price: 4500,
      missing_price: 500,
      coverage_percentage: 90,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('Total: 5000 transactions');
    expect(result).toContain('With price: 4500');
    expect(result).toContain('Missing: 500');
  });

  it('should format single transaction', () => {
    const coverage = createCoverageInfo({
      total_transactions: 1,
      with_price: 1,
      missing_price: 0,
      coverage_percentage: 100,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('Total: 1 transactions'); // Note: doesn't pluralize
    expect(result).toContain('✓');
  });

  it('should format zero transactions', () => {
    const coverage = createCoverageInfo({
      total_transactions: 0,
      with_price: 0,
      missing_price: 0,
      coverage_percentage: 0,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('Total: 0 transactions');
    expect(result).toContain('• BTC'); // 0 missing = bullet icon
  });

  it('should format low coverage percentage', () => {
    const coverage = createCoverageInfo({
      total_transactions: 100,
      with_price: 10,
      missing_price: 90,
      coverage_percentage: 10,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('Coverage: 10.0%');
    expect(result).toContain('⚠');
  });

  it('should format very high coverage percentage', () => {
    const coverage = createCoverageInfo({
      total_transactions: 1000,
      with_price: 999,
      missing_price: 1,
      coverage_percentage: 99.9,
    });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('Coverage: 99.9%');
    expect(result).toContain('⚠'); // Has missing
  });

  it('should contain all required lines', () => {
    const coverage = createCoverageInfo();

    const result = formatPriceCoverageForDisplay(coverage);
    const lines = result.split('\n');

    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^[⚠•✓] /); // Icon + asset
    expect(lines[1]).toMatch(/^\s+Total:/);
    expect(lines[2]).toMatch(/^\s+With price:/);
    expect(lines[3]).toMatch(/^\s+Missing:/);
    expect(lines[4]).toMatch(/^\s+Coverage:/);
  });

  it('should handle long asset names', () => {
    const coverage = createCoverageInfo({ asset: 'VERYLONGASSETNAME' });

    const result = formatPriceCoverageForDisplay(coverage);

    expect(result).toContain('⚠ VERYLONGASSETNAME');
  });
});

describe('formatPriceCoverageListForDisplay', () => {
  const createResult = (coverages: PriceCoverageInfo[] = []): ViewPricesResult => {
    const totalTransactions = coverages.reduce((sum, c) => sum + c.total_transactions, 0);
    const withPrice = coverages.reduce((sum, c) => sum + c.with_price, 0);
    const missingPrice = coverages.reduce((sum, c) => sum + c.missing_price, 0);
    const overallCoverage = totalTransactions > 0 ? (withPrice / totalTransactions) * 100 : 0;

    return {
      coverage: coverages,
      summary: {
        total_transactions: totalTransactions,
        with_price: withPrice,
        missing_price: missingPrice,
        overall_coverage_percentage: overallCoverage,
      },
    };
  };

  const createCoverageInfo = (overrides: Partial<PriceCoverageInfo> = {}): PriceCoverageInfo => ({
    asset: 'BTC',
    total_transactions: 100,
    with_price: 90,
    missing_price: 10,
    coverage_percentage: 90,
    ...overrides,
  });

  it('should format empty result with no transactions', () => {
    const result = createResult([]);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('Price Coverage by Asset:');
    expect(output).toContain('No transaction data found.');
    expect(output).toContain('Total transactions: 0');
    expect(output).toContain('With price: 0');
    expect(output).toContain('Missing price: 0');
    expect(output).toContain('Overall coverage: 0.0%');
  });

  it('should format single asset coverage', () => {
    const coverages = [createCoverageInfo({ asset: 'BTC' })];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('Price Coverage by Asset:');
    expect(output).toContain('⚠ BTC');
    expect(output).toContain('Total: 100 transactions');
    expect(output).toContain('Summary:');
    expect(output).toContain('Total transactions: 100');
    expect(output).toContain('With price: 90');
    expect(output).toContain('Missing price: 10');
    expect(output).toContain('Overall coverage: 90.0%');
  });

  it('should format multiple asset coverages', () => {
    const coverages = [
      createCoverageInfo({ asset: 'BTC', total_transactions: 100, with_price: 90, missing_price: 10 }),
      createCoverageInfo({ asset: 'ETH', total_transactions: 200, with_price: 180, missing_price: 20 }),
      createCoverageInfo({
        asset: 'SOL',
        total_transactions: 50,
        with_price: 50,
        missing_price: 0,
        coverage_percentage: 100,
      }),
    ];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('⚠ BTC');
    expect(output).toContain('⚠ ETH');
    expect(output).toContain('✓ SOL');
    expect(output).toContain('Total transactions: 350');
    expect(output).toContain('With price: 320');
    expect(output).toContain('Missing price: 30');
    // 320 / 350 = 91.43%
    expect(output).toContain('Overall coverage: 91.4%');
  });

  it('should show success message with missingOnly flag when all covered', () => {
    const result: ViewPricesResult = {
      coverage: [],
      summary: {
        total_transactions: 100,
        with_price: 100,
        missing_price: 0,
        overall_coverage_percentage: 100,
      },
    };

    const output = formatPriceCoverageListForDisplay(result, true);

    expect(output).toContain('✓ All assets have complete price coverage!');
    expect(output).toContain('Analyzed 100 transactions with 100% price coverage.');
  });

  it('should show no data message when missingOnly and no transactions', () => {
    const result = createResult([]);

    const output = formatPriceCoverageListForDisplay(result, true);

    expect(output).toContain('No transaction data found.');
    expect(output).not.toContain('All assets have complete price coverage');
  });

  it('should format with header and footer separators', () => {
    const coverages = [createCoverageInfo({ asset: 'BTC' })];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('=============================');
    const separatorCount = (output.match(/=============================/g) || []).length;
    expect(separatorCount).toBeGreaterThanOrEqual(2);
  });

  it('should have blank lines for readability', () => {
    const coverages = [createCoverageInfo({ asset: 'BTC' })];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toMatch(/\n\n/); // Has double newlines
  });

  it('should format 100% coverage correctly', () => {
    const coverages = [
      createCoverageInfo({
        asset: 'BTC',
        total_transactions: 100,
        with_price: 100,
        missing_price: 0,
        coverage_percentage: 100,
      }),
    ];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('✓ BTC');
    expect(output).toContain('Overall coverage: 100.0%');
  });

  it('should format 0% coverage correctly', () => {
    const coverages = [
      createCoverageInfo({
        asset: 'BTC',
        total_transactions: 100,
        with_price: 0,
        missing_price: 100,
        coverage_percentage: 0,
      }),
    ];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('⚠ BTC');
    expect(output).toContain('Overall coverage: 0.0%');
  });

  it('should separate multiple assets with blank lines', () => {
    const coverages = [createCoverageInfo({ asset: 'BTC' }), createCoverageInfo({ asset: 'ETH' })];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    // Each asset format ends with a blank line
    expect(output).toContain('Coverage: 90.0%\n\n');
  });

  it('should calculate correct overall coverage with mixed assets', () => {
    const coverages = [
      createCoverageInfo({ asset: 'BTC', total_transactions: 100, with_price: 100, missing_price: 0 }),
      createCoverageInfo({ asset: 'ETH', total_transactions: 100, with_price: 50, missing_price: 50 }),
    ];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    // (100 + 50) / (100 + 100) = 150 / 200 = 75%
    expect(output).toContain('Overall coverage: 75.0%');
  });

  it('should handle large numbers in summary', () => {
    const coverages = [
      createCoverageInfo({
        asset: 'BTC',
        total_transactions: 10000,
        with_price: 9500,
        missing_price: 500,
        coverage_percentage: 95,
      }),
    ];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);

    expect(output).toContain('Total transactions: 10000');
    expect(output).toContain('With price: 9500');
    expect(output).toContain('Missing price: 500');
  });

  it('should format complete text output structure', () => {
    const coverages = [createCoverageInfo({ asset: 'BTC' })];
    const result = createResult(coverages);

    const output = formatPriceCoverageListForDisplay(result);
    const lines = output.split('\n');

    // Should have header, content, separator, summary
    expect(lines.some((line) => line.includes('Price Coverage by Asset:'))).toBe(true);
    expect(lines.some((line) => line.includes('BTC'))).toBe(true);
    expect(lines.some((line) => line.includes('Summary:'))).toBe(true);
    expect(lines.some((line) => line.includes('Total transactions:'))).toBe(true);
  });
});
