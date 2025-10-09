import path from 'node:path';

import type { BalanceVerificationResult } from '@exitbook/balance';
import { closeDatabase, initializeDatabase } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { VerifyHandler, type VerifyHandlerParams } from '../handlers/verify-handler.js';
import { ExitCodes } from '../lib/exit-codes.js';
import { OutputManager } from '../lib/output.js';
import { handleCancellation, promptConfirm } from '../lib/prompts.js';
import { promptForVerifyParams } from '../lib/verify-prompts.js';
import { buildVerifyParamsFromFlags, type VerifyCommandOptions } from '../lib/verify-utils.js';

const logger = getLogger('VerifyCommand');

/**
 * Extended verify command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedVerifyCommandOptions extends VerifyCommandOptions {
  clearDb?: boolean | undefined;
  json?: boolean | undefined;
}

/**
 * Verify command result data.
 */
interface VerifyCommandResult {
  reportPath?: string | undefined;
  results: {
    comparisons: number;
    matches: number;
    mismatches: number;
    source: string;
    status: string;
    totalCurrencies: number;
    warnings: number;
  }[];
}

/**
 * Register the verify command.
 */
export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Verify calculated balances from imported transaction data')
    .option('--exchange <name>', 'Exchange name to verify (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name to verify (e.g., bitcoin, ethereum)')
    .option('--report', 'Generate detailed verification report')
    .option('--clear-db', 'Clear and reinitialize database before verification')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedVerifyCommandOptions) => {
      await executeVerifyCommand(options);
    });
}

/**
 * Execute the verify command.
 */
async function executeVerifyCommand(options: ExtendedVerifyCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Detect mode: interactive vs flag
    const isInteractiveMode = !options.exchange && !options.blockchain && !options.json;

    let params: VerifyHandlerParams;

    if (isInteractiveMode) {
      // Interactive mode - use @clack/prompts
      output.intro('exitbook verify');

      params = await promptForVerifyParams();

      // Confirm before proceeding
      const shouldProceed = await promptConfirm('Start verification?', true);
      if (!shouldProceed) {
        handleCancellation('Verification cancelled');
      }
    } else {
      // Flag mode or JSON mode - use provided options
      params = buildParamsFromFlags(options);
    }

    // Initialize database
    const database = await initializeDatabase(options.clearDb);

    // Create handler and execute
    const handler = new VerifyHandler(database);

    try {
      // Show spinner in text mode
      const spinner = output.spinner();
      if (spinner) {
        spinner.start('Verifying balances...');
      }

      const result = await handler.execute(params);

      if (spinner) {
        spinner.stop(result.isOk() ? 'Verification complete' : 'Verification failed');
      }

      if (result.isErr()) {
        await closeDatabase(database);
        handler.destroy();
        output.error('verify', result.error, ExitCodes.GENERAL_ERROR);
        return; // TypeScript doesn't know output.error never returns, so add explicit return
      }

      const verifyResult = result.value;

      // Display results in text mode
      if (output.isTextMode()) {
        displayVerificationResults(verifyResult.results);
      }

      // Save report to file if generated
      let reportPath: string | undefined;
      if (verifyResult.report) {
        reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
        await import('node:fs').then((fs) => fs.promises.writeFile(reportPath!, verifyResult.report!));

        if (output.isTextMode()) {
          output.log(`\n📄 Verification report saved: ${reportPath}`);
        }
      }

      // Prepare result data for JSON mode
      const resultData: VerifyCommandResult = {
        results: verifyResult.results.map((r) => ({
          source: r.source,
          status: r.status,
          totalCurrencies: r.summary.totalCurrencies,
          matches: r.summary.matches,
          warnings: r.summary.warnings,
          mismatches: r.summary.mismatches,
          comparisons: r.comparisons.length,
        })),
      };

      if (reportPath) {
        resultData.reportPath = reportPath;
      }

      // Output success
      if (output.isTextMode()) {
        output.outro(`✨ Verification complete!`);
      }

      output.success('verify', resultData);

      await closeDatabase(database);
      handler.destroy();
      process.exit(0);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      throw error;
    }
  } catch (error) {
    output.error('verify', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Build verify parameters from CLI flags.
 * Throws error for commander to handle.
 */
function buildParamsFromFlags(options: ExtendedVerifyCommandOptions): VerifyHandlerParams {
  const result = buildVerifyParamsFromFlags(options);
  if (result.isErr()) {
    throw result.error; // Convert Result to throw for commander error handling
  }
  return result.value;
}

/**
 * Display verification results in the console.
 */
function displayVerificationResults(results: BalanceVerificationResult[]): void {
  logger.info('\nBalance Verification Results');
  logger.info('================================');

  for (const result of results) {
    logger.info(`\n${result.source} - ${result.status.toUpperCase()}`);

    if (result.error) {
      logger.error(`  Error: ${result.error}`);
      continue;
    }

    // Special handling for CSV adapters (indicated by note about CSV adapter)
    if (result.note && result.note.includes('showing calculated balances')) {
      logger.info(`  Calculated Balances Summary (${result.summary.totalCurrencies} currencies)`);

      // Show all non-zero calculated balances for CSV adapters
      const significantBalances = result.comparisons
        .filter((c) => Math.abs(c.calculatedBalance) > 0.00000001)
        .sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance));

      if (significantBalances.length > 0) {
        logger.info('  Current balances:');
        for (const balance of significantBalances.slice(0, 25)) {
          // Show top 25
          const formattedBalance = balance.calculatedBalance.toFixed(8).replace(/\.?0+$/, '');
          logger.info(`    ${balance.currency}: ${formattedBalance}`);
        }

        if (significantBalances.length > 25) {
          logger.info(`    ... and ${significantBalances.length - 25} more currencies`);
        }

        // Show zero balances count if any
        const zeroBalances = result.comparisons.length - significantBalances.length;
        if (zeroBalances > 0) {
          logger.info(`  Zero balances: ${zeroBalances} currencies`);
        }
      } else {
        logger.info('  No significant balances found');
      }

      logger.info(`  Note: ${result.note}`);
    } else {
      // Standard live balance verification display
      logger.info(`  Currencies: ${result.summary.totalCurrencies}`);
      logger.info(`  Matches: ${result.summary.matches}`);
      logger.info(`  Warnings: ${result.summary.warnings}`);
      logger.info(`  Mismatches: ${result.summary.mismatches}`);

      // Show calculated balances for significant currencies
      const significantBalances = result.comparisons
        .filter(
          (c) =>
            result.status === 'warning' ||
            Math.abs(c.calculatedBalance) > 0.00000001 ||
            Math.abs(c.liveBalance) > 0.00000001
        )
        .sort((a, b) => Math.abs(b.calculatedBalance) - Math.abs(a.calculatedBalance))
        .slice(0, 10); // Show top 10

      if (significantBalances.length > 0) {
        logger.info('  Calculated vs Live Balances:');
        for (const balance of significantBalances) {
          const calc = balance.calculatedBalance.toFixed(8).replace(/\.?0+$/, '');
          const live = balance.liveBalance.toFixed(8).replace(/\.?0+$/, '');
          const status = balance.status === 'match' ? '✓' : balance.status === 'warning' ? '⚠' : '✗';
          logger.info(`    ${balance.currency}: ${calc} (calc) | ${live} (live) ${status}`);
        }
      }

      // Show top issues
      const issues = result.comparisons.filter((c) => c.status !== 'match').slice(0, 3);
      if (issues.length > 0) {
        logger.info('  Top issues:');
        for (const issue of issues) {
          logger.info(`    ${issue.currency}: ${issue.difference.toFixed(8)} (${issue.percentageDiff.toFixed(2)}%)`);
        }
      }
    }
  }
}
