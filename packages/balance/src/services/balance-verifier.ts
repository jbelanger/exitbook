import { BalanceRepository, BalanceService } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { Decimal } from 'decimal.js';

import type {
  BalanceComparison,
  BalanceVerificationRecord,
  BalanceVerificationResult,
} from '../types/balance-types.js';
import type { IBalanceService } from './balance-service.js';

export class BalanceVerifier {
  private logger = getLogger('BalanceVerifier');
  private balanceService: BalanceService;

  constructor(balanceService: BalanceService) {
    this.balanceService = balanceService;
  }

  async verifyAllServices(services: IBalanceService[]): Promise<BalanceVerificationResult[]> {
    this.logger.info('Starting balance verification for all services');
    const results: BalanceVerificationResult[] = [];

    for (const service of services) {
      try {
        const result = await this.verifyService(service);
        results.push(result);
      } catch (error) {
        const serviceId = service.getServiceId();
        this.logger.error(
          `Balance verification failed for ${serviceId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );

        results.push({
          exchange: serviceId,
          timestamp: Date.now(),
          status: 'error',
          comparisons: [],
          error: error instanceof Error ? error.message : 'Unknown error',
          summary: {
            totalCurrencies: 0,
            matches: 0,
            mismatches: 0,
            warnings: 0,
          },
        });
      }
    }

    this.logger.info(`Balance verification completed for ${results.length} services`);
    return results;
  }

  async verifyService(service: IBalanceService): Promise<BalanceVerificationResult> {
    const serviceId = service.getServiceId();
    const capabilities = service.getCapabilities();

    this.logger.info(`Starting balance verification for ${serviceId}`);

    try {
      // Check if this service supports balance fetching
      if (!service.supportsLiveBalanceFetching()) {
        this.logger.info(
          `Skipping balance verification for ${serviceId} - service does not support live balance fetching`
        );

        // For services without live balance, show calculated balances as informational
        const calculatedBalances = await this.balanceService.calculateBalances(serviceId);
        const comparisons = this.createCalculatedOnlyComparisons(calculatedBalances);

        const result: BalanceVerificationResult = {
          exchange: serviceId,
          timestamp: Date.now(),
          status: 'warning', // Warning because we can't verify against live data
          comparisons,
          summary: {
            totalCurrencies: comparisons.length,
            matches: 0,
            mismatches: 0,
            warnings: comparisons.length,
          },
          note: `${capabilities.name} - showing calculated balances only (no live verification possible)`,
        };

        this.logger.info(
          `Balance calculation completed for ${serviceId} (calculated mode) - TotalCurrencies: ${result.summary.totalCurrencies}`
        );

        return result;
      }

      // Get current live balances from service
      const liveBalances = await service.getBalances();

      // Calculate balances from our stored transactions
      const calculatedBalances = await this.balanceService.calculateBalances(serviceId);

      // Compare balances
      const comparisons = this.compareBalances(liveBalances, calculatedBalances);

      // Determine overall status
      const status = this.determineVerificationStatus(comparisons);

      // Create summary
      const summary = this.createSummary(comparisons);

      // Store verification results in database
      await this.storeVerificationResults(serviceId, comparisons);

      // Log results
      this.logVerificationResults(serviceId, comparisons);

      const result: BalanceVerificationResult = {
        exchange: serviceId,
        timestamp: Date.now(),
        status,
        comparisons,
        summary,
      };

      this.logger.info(
        `Balance verification completed for ${serviceId} - Status: ${status}, TotalCurrencies: ${summary.totalCurrencies}, Matches: ${summary.matches}, Mismatches: ${summary.mismatches}`
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Balance verification failed for ${serviceId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  private compareBalances(
    liveBalances: Record<string, number>,
    calculatedBalances: Record<string, Decimal>,
    tolerance: number = 0.00000001
  ): BalanceComparison[] {
    const comparisons: BalanceComparison[] = [];
    const allCurrencies = new Set([...Object.keys(liveBalances), ...Object.keys(calculatedBalances)]);

    for (const currency of Array.from(allCurrencies)) {
      const liveBalance = liveBalances[currency] || 0;
      const calculatedBalance = calculatedBalances[currency]?.toNumber() || 0;
      const difference = Math.abs(liveBalance - calculatedBalance);
      const percentageDiff = liveBalance !== 0 ? (difference / Math.abs(liveBalance)) * 100 : 0;

      let status: 'match' | 'mismatch' | 'warning';

      if (difference <= tolerance) {
        status = 'match';
      } else if (percentageDiff < 1) {
        // Less than 1% difference
        status = 'warning';
      } else {
        status = 'mismatch';
      }

      comparisons.push({
        currency,
        liveBalance,
        calculatedBalance,
        difference,
        status,
        percentageDiff,
        tolerance,
      });
    }

    return comparisons.sort((a, b) => b.difference - a.difference);
  }

  private determineVerificationStatus(comparisons: BalanceComparison[]): 'success' | 'error' | 'warning' {
    const mismatches = comparisons.filter(c => c.status === 'mismatch');
    const warnings = comparisons.filter(c => c.status === 'warning');

    if (mismatches.length > 0) {
      return 'error';
    } else if (warnings.length > 0) {
      return 'warning';
    } else {
      return 'success';
    }
  }

  private createSummary(comparisons: BalanceComparison[]) {
    return {
      totalCurrencies: comparisons.length,
      matches: comparisons.filter(c => c.status === 'match').length,
      mismatches: comparisons.filter(c => c.status === 'mismatch').length,
      warnings: comparisons.filter(c => c.status === 'warning').length,
    };
  }

  private async storeVerificationResults(exchangeId: string, comparisons: BalanceComparison[]): Promise<void> {
    const timestamp = Date.now();

    for (const comparison of comparisons) {
      const record: BalanceVerificationRecord = {
        exchange: exchangeId,
        currency: comparison.currency,
        expected_balance: comparison.liveBalance,
        actual_balance: comparison.calculatedBalance,
        difference: comparison.difference,
        status: comparison.status,
        timestamp,
        created_at: Date.now(),
      };

      await this.balanceService.saveVerification(record);
    }
  }

  private logVerificationResults(exchangeId: string, comparisons: BalanceComparison[]): void {
    for (const comparison of comparisons) {
      this.logBalanceVerification(exchangeId, comparison.currency, comparison);

      // Log significant discrepancies as errors
      if (comparison.status === 'mismatch' && comparison.percentageDiff > 5) {
        this.logBalanceDiscrepancy(exchangeId, comparison.currency, comparison);
      }
    }
  }

  private createCalculatedOnlyComparisons(calculatedBalances: Record<string, Decimal>): BalanceComparison[] {
    const comparisons: BalanceComparison[] = [];

    for (const [currency, balance] of Object.entries(calculatedBalances)) {
      const balanceNumber = balance.toNumber();
      // For CSV adapters, we show calculated balance as both live and calculated
      // since we can't fetch live balances
      comparisons.push({
        currency,
        liveBalance: 0, // No live balance available
        calculatedBalance: balanceNumber,
        difference: balanceNumber, // Difference is the calculated balance itself
        status: 'warning', // Always warning since we can't verify
        percentageDiff: 0,
        tolerance: 0,
      });
    }

    return comparisons.sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance));
  }

  async getVerificationHistory(exchangeId?: string): Promise<BalanceVerificationRecord[]> {
    return await this.balanceService.getLatestVerifications(exchangeId);
  }

  // Generate a verification report
  async generateReport(results: BalanceVerificationResult[]): Promise<string> {
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
      const issues = result.comparisons.filter(c => c.status !== 'match');
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
    const successfulExchanges = results.filter(r => r.status === 'success').length;
    const warningExchanges = results.filter(r => r.status === 'warning').length;
    const errorExchanges = results.filter(r => r.status === 'error').length;

    report += `## Overall Summary\n`;
    report += `- **Total Exchanges**: ${totalExchanges}\n`;
    report += `- **Successful**: ${successfulExchanges}\n`;
    report += `- **Warnings**: ${warningExchanges}\n`;
    report += `- **Errors**: ${errorExchanges}\n\n`;

    return report;
  }

  // Check if verification is needed (e.g., hasn't been run in X hours)
  async shouldRunVerification(exchangeId: string, maxAgeHours: number = 24): Promise<boolean> {
    const latestVerifications = await this.balanceService.getLatestVerifications(exchangeId);

    if (latestVerifications.length === 0) {
      return true; // Never verified
    }

    const latestTimestamp = Math.max(...latestVerifications.map((v: BalanceVerificationRecord) => v.timestamp));
    const ageHours = (Date.now() - latestTimestamp) / (1000 * 60 * 60);

    return ageHours >= maxAgeHours;
  }

  private logBalanceVerification(exchange: string, currency: string, result: BalanceComparison) {
    const level = result.status === 'mismatch' ? 'warn' : 'info';
    const message = `Balance verification ${result.status} for ${exchange} ${currency}`;

    this.logger[level](
      `${message} - Exchange: ${exchange}, Currency: ${currency}, Operation: balance_verification, LiveBalance: ${result.liveBalance}, CalculatedBalance: ${result.calculatedBalance}, Difference: ${result.difference}, PercentageDiff: ${result.percentageDiff}%, Status: ${result.status}`
    );
  }

  private logBalanceDiscrepancy(exchange: string, currency: string, discrepancy: BalanceComparison) {
    this.logger.error(
      `Significant balance discrepancy detected - Exchange: ${exchange}, Currency: ${currency}, Operation: balance_verification_error, LiveBalance: ${discrepancy.liveBalance}, CalculatedBalance: ${discrepancy.calculatedBalance}, Difference: ${discrepancy.difference}, PercentageDiff: ${discrepancy.percentageDiff}%`
    );
  }
}
