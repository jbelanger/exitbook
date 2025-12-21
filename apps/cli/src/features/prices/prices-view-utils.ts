// Utilities and types for view prices command

import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Parameters for view prices command.
 */
export interface ViewPricesParams extends CommonViewFilters {
  asset?: string | undefined;
  missingOnly?: boolean | undefined;
}

/**
 * Price coverage info for a single asset.
 */
export interface PriceCoverageInfo {
  assetSymbol: string;
  total_transactions: number;
  with_price: number;
  missing_price: number;
  coverage_percentage: number;
}

/**
 * Result of view prices command.
 */
export interface ViewPricesResult {
  coverage: PriceCoverageInfo[];
  summary: {
    missing_price: number;
    overall_coverage_percentage: number;
    total_transactions: number;
    with_price: number;
  };
}

/**
 * Format coverage percentage for display.
 */
export function formatCoveragePercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

/**
 * Format a single price coverage entry for text display.
 */
export function formatPriceCoverageForDisplay(coverage: PriceCoverageInfo): string {
  const lines: string[] = [];
  const coverageStr = formatCoveragePercentage(coverage.coverage_percentage);
  const icon = coverage.coverage_percentage === 100 ? '✓' : coverage.missing_price > 0 ? '⚠' : '•';

  lines.push(`${icon} ${coverage.assetSymbol}`);
  lines.push(`   Total: ${coverage.total_transactions} transactions`);
  lines.push(`   With price: ${coverage.with_price}`);
  lines.push(`   Missing: ${coverage.missing_price}`);
  lines.push(`   Coverage: ${coverageStr}`);

  return lines.join('\n');
}

/**
 * Format price coverage list for text display.
 */
export function formatPriceCoverageListForDisplay(result: ViewPricesResult, missingOnly?: boolean): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Price Coverage by Asset:');
  lines.push('=============================');
  lines.push('');

  if (result.coverage.length === 0) {
    if (missingOnly && result.summary.total_transactions > 0) {
      lines.push('✓ All assets have complete price coverage!');
      lines.push('');
      lines.push(`Analyzed ${result.summary.total_transactions} transactions with 100% price coverage.`);
    } else {
      lines.push('No transaction data found.');
    }
  } else {
    for (const coverage of result.coverage) {
      lines.push(formatPriceCoverageForDisplay(coverage));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push('Summary:');
  lines.push(`   Total transactions: ${result.summary.total_transactions}`);
  lines.push(`   With price: ${result.summary.with_price}`);
  lines.push(`   Missing price: ${result.summary.missing_price}`);
  lines.push(`   Overall coverage: ${formatCoveragePercentage(result.summary.overall_coverage_percentage)}`);

  return lines.join('\n');
}
