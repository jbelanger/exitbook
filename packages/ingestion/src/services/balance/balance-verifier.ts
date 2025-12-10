import type { Account } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { BalanceComparison, BalanceVerificationResult } from './balance-verifier.types.js';

/**
 * Compare calculated balances against live balances from an API.
 * Pure function that performs balance verification logic.
 */
export function compareBalances(
  calculated: Record<string, Decimal>,
  live: Record<string, Decimal>,
  tolerance = 0.00000001 // Default tolerance for floating point comparison
): BalanceComparison[] {
  const comparisons: BalanceComparison[] = [];

  // Get all unique currencies from both calculated and live balances
  const allCurrencies = new Set([...Object.keys(calculated), ...Object.keys(live)]);

  for (const currency of allCurrencies) {
    const calcBalance = calculated[currency] || parseDecimal('0');
    const liveBalance = live[currency] || parseDecimal('0');

    const difference = calcBalance.minus(liveBalance);
    const absDifference = difference.abs();

    let status: 'match' | 'warning' | 'mismatch';
    // Calculate percentage difference (avoid division by zero)
    let percentageDiff = 0;

    // If we're within tolerance, treat as match and zero-out percentage difference to avoid misleading 100% values
    if (absDifference.lessThanOrEqualTo(tolerance)) {
      status = 'match';
      percentageDiff = 0;
    } else {
      if (!liveBalance.isZero()) {
        percentageDiff = absDifference.dividedBy(liveBalance.abs()).times(100).toNumber();
      } else if (!calcBalance.isZero()) {
        percentageDiff = 100; // If live is zero but calculated isn't, 100% difference
      }

      if (percentageDiff < 1) {
        // Less than 1% difference is a warning
        status = 'warning';
      } else {
        status = 'mismatch';
      }
    }

    comparisons.push({
      currency,
      calculatedBalance: calcBalance.toFixed(),
      liveBalance: liveBalance.toFixed(),
      difference: difference.toFixed(),
      percentageDiff,
      status,
    });
  }

  // Sort by absolute calculated balance (largest first)
  return comparisons.sort((a, b) => {
    const absA = parseDecimal(a.calculatedBalance).abs();
    const absB = parseDecimal(b.calculatedBalance).abs();
    return absB.comparedTo(absA);
  });
}

/**
 * Generate a verification result from comparisons.
 * Pure function that summarizes comparison data.
 */
export function createVerificationResult(
  account: Account,
  comparisons: BalanceComparison[],
  lastImportTimestamp?: number,
  hasTransactions = true
): BalanceVerificationResult {
  const summary = {
    totalCurrencies: comparisons.length,
    matches: comparisons.filter((c) => c.status === 'match').length,
    warnings: comparisons.filter((c) => c.status === 'warning').length,
    mismatches: comparisons.filter((c) => c.status === 'mismatch').length,
  };

  // Determine overall status
  // If no transactions exist in DB, treat mismatches as warnings (not failures)
  let status: 'success' | 'warning' | 'failed';
  if (summary.mismatches > 0 && hasTransactions) {
    status = 'failed';
  } else if (summary.warnings > 0 || summary.mismatches > 0) {
    status = 'warning';
  } else {
    status = 'success';
  }

  // Generate suggestion if there are mismatches
  let suggestion: string | undefined;
  if (summary.mismatches > 0) {
    if (!hasTransactions) {
      suggestion = 'No transactions imported yet. Run import to fetch transaction history.';
    } else if (lastImportTimestamp) {
      const daysSinceImport = (Date.now() - lastImportTimestamp) / (1000 * 60 * 60 * 24);

      if (daysSinceImport > 7) {
        const daysRounded = Math.floor(daysSinceImport);
        suggestion = `Last import was ${daysRounded} days ago. Run import again to fetch recent transactions.`;
      } else {
        suggestion =
          'Balance mismatch detected. You may have missing transactions. Try running import again to ensure all transactions are captured.';
      }
    } else {
      suggestion = 'No transactions imported yet. Run import to fetch transaction history.';
    }
  }

  return {
    account,
    timestamp: Date.now(),
    status,
    comparisons,
    summary,
    suggestion,
  };
}

/**
 * Generate a markdown report from verification results.
 * Pure function that formats verification data.
 */
export function generateVerificationReport(results: BalanceVerificationResult[]): string {
  const timestamp = new Date().toISOString();
  let report = `# Balance Verification Report - ${timestamp}\n\n`;

  for (const result of results) {
    report += `## ${result.account.sourceName} (${result.account.accountType})\n`;
    report += `- **Account ID**: ${result.account.id}\n`;
    report += `- **Status**: ${result.status.toUpperCase()}\n`;
    report += `- **Total Currencies**: ${result.summary.totalCurrencies}\n`;
    report += `- **Matches**: ${result.summary.matches}\n`;
    report += `- **Warnings**: ${result.summary.warnings}\n`;
    report += `- **Mismatches**: ${result.summary.mismatches}\n\n`;

    if (result.suggestion) {
      report += `- **Suggestion**: ${result.suggestion}\n\n`;
    }

    // Show problematic balances
    const issues = result.comparisons.filter((c) => c.status !== 'match');
    if (issues.length > 0) {
      report += `### Issues Found:\n`;
      for (const issue of issues) {
        report += `- **${issue.currency}**: `;
        report += `Live: ${issue.liveBalance}, `;
        report += `Calculated: ${issue.calculatedBalance}, `;
        report += `Diff: ${issue.difference} (${issue.percentageDiff.toFixed(2)}%)\n`;
      }
      report += '\n';
    }
  }

  // Overall summary
  const totalAccounts = results.length;
  const successfulAccounts = results.filter((r) => r.status === 'success').length;
  const warningAccounts = results.filter((r) => r.status === 'warning').length;
  const failedAccounts = results.filter((r) => r.status === 'failed').length;

  report += `## Overall Summary\n`;
  report += `- **Total Accounts**: ${totalAccounts}\n`;
  report += `- **Successful**: ${successfulAccounts}\n`;
  report += `- **Warnings**: ${warningAccounts}\n`;
  report += `- **Failed**: ${failedAccounts}\n\n`;

  return report;
}
