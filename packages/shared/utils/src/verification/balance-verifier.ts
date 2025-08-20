import type { BalanceComparison, BalanceVerificationRecord, BalanceVerificationResult, IExchangeAdapter } from '@crypto/core';
import type { Database } from '@crypto/data';
import { BalanceRepository, BalanceService } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';


export class BalanceVerifier {
  private logger = getLogger('BalanceVerifier');
  private database: Database;
  private balanceService: BalanceService;

  constructor(database: Database) {
    this.database = database;
    const balanceRepository = new BalanceRepository(database);
    this.balanceService = new BalanceService(balanceRepository);
  }

  async verifyAllExchanges(exchanges: IExchangeAdapter[]): Promise<BalanceVerificationResult[]> {
    this.logger.info('Starting balance verification for all exchanges');
    const results: BalanceVerificationResult[] = [];

    for (const exchange of exchanges) {
      try {
        const result = await this.verifyExchange(exchange);
        results.push(result);
      } catch (error) {
        const exchangeInfo = await exchange.getExchangeInfo().catch(() => ({ id: 'unknown' }));
        this.logger.error(`Balance verification failed for ${exchangeInfo.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        results.push({
          exchange: exchangeInfo.id,
          timestamp: Date.now(),
          status: 'error',
          comparisons: [],
          error: error instanceof Error ? error.message : 'Unknown error',
          summary: {
            totalCurrencies: 0,
            matches: 0,
            mismatches: 0,
            warnings: 0
          }
        });
      }
    }

    this.logger.info(`Balance verification completed for ${results.length} exchanges`);
    return results;
  }

  async verifyExchange(exchange: IExchangeAdapter): Promise<BalanceVerificationResult> {
    const exchangeInfo = await exchange.getExchangeInfo();
    const exchangeId = exchangeInfo.id;

    this.logger.info(`Starting balance verification for ${exchangeId}`);

    try {
      // Check if this adapter supports balance fetching
      if (!exchangeInfo.capabilities.fetchBalance) {
        this.logger.info(`Skipping balance verification for ${exchangeId} - adapter does not support live balance fetching`);

        // For CSV adapters, we can still show calculated balances as informational
        const calculatedBalances = await this.balanceService.calculateBalances(exchangeId);
        const comparisons = this.createCalculatedOnlyComparisons(calculatedBalances);

        const result: BalanceVerificationResult = {
          exchange: exchangeId,
          timestamp: Date.now(),
          status: 'warning', // Warning because we can't verify against live data
          comparisons,
          summary: {
            totalCurrencies: comparisons.length,
            matches: 0,
            mismatches: 0,
            warnings: comparisons.length
          },
          note: 'CSV adapter - showing calculated balances only (no live verification possible)'
        };

        this.logger.info(`Balance calculation completed for ${exchangeId} (CSV mode)`, {
          totalCurrencies: result.summary.totalCurrencies
        });

        return result;
      }

      // Get current live balances from exchange
      const liveBalance = await exchange.fetchBalance();

      // Calculate balances from our stored transactions
      const calculatedBalances = await this.balanceService.calculateBalances(exchangeId);

      // Compare balances - convert array to object format
      const liveBalanceObj = this.convertBalanceArrayToObject(liveBalance);
      const comparisons = this.compareBalances(liveBalanceObj, calculatedBalances);

      // Determine overall status
      const status = this.determineVerificationStatus(comparisons);

      // Create summary
      const summary = this.createSummary(comparisons);

      // Store verification results in database
      await this.storeVerificationResults(exchangeId, comparisons);

      // Log results
      this.logVerificationResults(exchangeId, comparisons);

      const result: BalanceVerificationResult = {
        exchange: exchangeId,
        timestamp: Date.now(),
        status,
        comparisons,
        summary
      };

      this.logger.info(`Balance verification completed for ${exchangeId}`, {
        status,
        totalCurrencies: summary.totalCurrencies,
        matches: summary.matches,
        mismatches: summary.mismatches
      });

      return result;
    } catch (error) {
      this.logger.error(`Balance verification failed for ${exchangeId}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private compareBalances(
    liveBalances: Record<string, number>,
    calculatedBalances: Record<string, number>,
    tolerance: number = 0.00000001
  ): BalanceComparison[] {
    const comparisons: BalanceComparison[] = [];
    const allCurrencies = new Set([
      ...Object.keys(liveBalances),
      ...Object.keys(calculatedBalances)
    ]);

    for (const currency of allCurrencies) {
      const liveBalance = liveBalances[currency] || 0;
      const calculatedBalance = calculatedBalances[currency] || 0;
      const difference = Math.abs(liveBalance - calculatedBalance);
      const percentageDiff = liveBalance !== 0 ? (difference / Math.abs(liveBalance)) * 100 : 0;

      let status: 'match' | 'mismatch' | 'warning';

      if (difference <= tolerance) {
        status = 'match';
      } else if (percentageDiff < 1) { // Less than 1% difference
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
        tolerance
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
      warnings: comparisons.filter(c => c.status === 'warning').length
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
        created_at: Date.now()
      };

      await this.balanceService.saveVerification(record);
    }
  }

  private logVerificationResults(exchangeId: string, comparisons: BalanceComparison[]): void {
    for (const comparison of comparisons) {
      this.logBalanceVerification(exchangeId, comparison.currency, comparison);

      // Log significant discrepancies as errors
      if (comparison.status === 'mismatch' && comparison.percentageDiff > 5) {
        this.logBalanceDiscrepancy(exchangeId, comparison.currency, {
          liveBalance: comparison.liveBalance,
          calculatedBalance: comparison.calculatedBalance,
          difference: comparison.difference,
          percentageDiff: comparison.percentageDiff
        });
      }
    }
  }

  private createCalculatedOnlyComparisons(calculatedBalances: Record<string, number>): BalanceComparison[] {
    const comparisons: BalanceComparison[] = [];

    for (const [currency, balance] of Object.entries(calculatedBalances)) {
      // For CSV adapters, we show calculated balance as both live and calculated
      // since we can't fetch live balances
      comparisons.push({
        currency,
        liveBalance: 0, // No live balance available
        calculatedBalance: balance,
        difference: balance, // Difference is the calculated balance itself
        status: 'warning', // Always warning since we can't verify
        percentageDiff: 0,
        tolerance: 0
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

  // Convert ExchangeBalance array to object format for compatibility
  private convertBalanceArrayToObject(balances: any[]): Record<string, number> {
    const balanceObj: Record<string, number> = {};

    for (const balance of balances) {
      if (balance.currency && balance.total !== undefined) {
        balanceObj[balance.currency] = balance.total;
      }
    }

    return balanceObj;
  }

  // Check if verification is needed (e.g., hasn't been run in X hours)
  async shouldRunVerification(exchangeId: string, maxAgeHours: number = 24): Promise<boolean> {
    const latestVerifications = await this.database.getLatestBalanceVerifications(exchangeId);

    if (latestVerifications.length === 0) {
      return true; // Never verified
    }

    const latestTimestamp = Math.max(...latestVerifications.map((v: BalanceVerificationRecord) => v.timestamp));
    const ageHours = (Date.now() - latestTimestamp) / (1000 * 60 * 60);

    return ageHours >= maxAgeHours;
  }

  logBalanceVerification(exchange: string, currency: string, result: any) {
    const level = result.status === 'mismatch' ? 'warn' : 'info';
    const message = `Balance verification ${result.status} for ${exchange} ${currency}`;

    this.logger[level](message, {
      exchange,
      currency,
      operation: 'balance_verification',
      liveBalance: result.liveBalance,
      calculatedBalance: result.calculatedBalance,
      difference: result.difference,
      percentageDiff: result.percentageDiff,
      status: result.status,
      timestamp: Date.now()
    });
  }

  logBalanceDiscrepancy(exchange: string, currency: string, discrepancy: any) {
    this.logger.error(`Significant balance discrepancy detected`, {
      exchange,
      currency,
      operation: 'balance_verification_error',
      ...discrepancy,
      timestamp: Date.now()
    });
  }
} 