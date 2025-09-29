import { getLogger } from '@crypto/shared-logger';
import type { Decimal } from 'decimal.js';

import type { BalanceVerificationResult, BalanceComparison } from '../../types/balance-types.js';

import type { BalanceService } from './balance-service.js';

export class BalanceVerifier {
  private balanceService: BalanceService;
  private logger = getLogger('BalanceVerifier');

  constructor(balanceService: BalanceService) {
    this.balanceService = balanceService;
  }

  // Generate a verification report
  generateReport(results: BalanceVerificationResult[]): string {
    const timestamp = new Date().toISOString();
    let report = `# Balance Verification Report - ${timestamp}\n\n`;

    for (const result of results) {
      report += `## ${result.exchange}\n`;
      report += `- **Status**: ${result.status.toUpperCase()}\n`;
      report += `- **Total Currencies**: ${result.summary.totalCurrencies}\n`;
      report += `- **Matches**: ${result.summary.matches}\n`;
      report += `- **Warnings**: ${result.summary.warnings}\n`;
      report += `- **Mismatches**: ${result.summary.mismatches}\n\n`;

      if (result.error) {
        report += `- **Error**: ${result.error}\n\n`;
        continue;
      }

      // Show problematic balances
      const issues = result.comparisons.filter((c) => c.status !== 'match');
      if (issues.length > 0) {
        report += `### Issues Found:\n`;
        for (const issue of issues) {
          report += `- **${issue.currency}**: `;
          report += `Live: ${issue.liveBalance.toFixed(8)}, `;
          report += `Calculated: ${issue.calculatedBalance.toFixed(8)}, `;
          report += `Diff: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)\n`;
        }
        report += '\n';
      }
    }

    // Overall summary
    const totalExchanges = results.length;
    const successfulExchanges = results.filter((r) => r.status === 'success').length;
    const warningExchanges = results.filter((r) => r.status === 'warning').length;
    const errorExchanges = results.filter((r) => r.status === 'error').length;

    report += `## Overall Summary\n`;
    report += `- **Total Exchanges**: ${totalExchanges}\n`;
    report += `- **Successful**: ${successfulExchanges}\n`;
    report += `- **Warnings**: ${warningExchanges}\n`;
    report += `- **Errors**: ${errorExchanges}\n\n`;

    return report;
  }

  async verifyExchangeById(exchangeId: string): Promise<BalanceVerificationResult[]> {
    this.logger.info(`Starting balance verification for ${exchangeId}`);

    try {
      const calculatedBalances = await this.balanceService.calculateBalancesForVerification(exchangeId);
      const comparisons = this.createCalculatedOnlyComparisons(calculatedBalances);

      const result: BalanceVerificationResult = {
        comparisons,
        exchange: exchangeId,
        note: `${exchangeId} - showing calculated balances from processed transactions`,
        status: 'warning',
        summary: {
          matches: 0,
          mismatches: 0,
          totalCurrencies: comparisons.length,
          warnings: comparisons.length,
        },
        timestamp: Date.now(),
      };

      this.logger.info(
        `Balance calculation completed for ${exchangeId} - TotalCurrencies: ${result.summary.totalCurrencies}`
      );

      return [result];
    } catch (error) {
      this.logger.error(
        `Balance verification failed for ${exchangeId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );

      return [
        {
          comparisons: [],
          error: error instanceof Error ? error.message : 'Unknown error',
          exchange: exchangeId,
          status: 'error',
          summary: {
            matches: 0,
            mismatches: 0,
            totalCurrencies: 0,
            warnings: 0,
          },
          timestamp: Date.now(),
        },
      ];
    }
  }
  private createCalculatedOnlyComparisons(calculatedBalances: Record<string, Decimal>): BalanceComparison[] {
    const comparisons: BalanceComparison[] = [];

    for (const [currency, balance] of Object.entries(calculatedBalances)) {
      const balanceNumber = balance.toNumber();
      // For CSV adapters, we show calculated balance as both live and calculated
      // since we can't fetch live balances
      comparisons.push({
        calculatedBalance: balanceNumber,
        currency,
        difference: balanceNumber, // Difference is the calculated balance itself
        liveBalance: 0, // No live balance available
        percentageDiff: 0,
        status: 'warning', // Always warning since we can't verify
        tolerance: 0,
      });
    }

    return comparisons.sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance));
  }
}
