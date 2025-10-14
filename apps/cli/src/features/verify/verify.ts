import path from 'node:path';

import type { BalanceVerificationResult } from '@exitbook/balance';
import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { VerifyResult } from './verify-handler.ts';
import { VerifyHandler } from './verify-handler.ts';
import { promptForVerifyParams } from './verify-prompts.ts';
import type { VerifyCommandOptions } from './verify-utils.ts';
import { buildVerifyParamsFromFlags } from './verify-utils.ts';

const logger = getLogger('VerifyCommand');

/**
 * Extended verify command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedVerifyCommandOptions extends VerifyCommandOptions {
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
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildVerifyParamsFromFlags(options)),
      cancelMessage: 'Verification cancelled',
      commandName: 'verify',
      confirmMessage: 'Start verification?',
      isInteractive: !options.exchange && !options.blockchain && !options.json,
      output,
      promptFn: promptForVerifyParams,
    });

    const spinner = output.spinner();
    spinner?.start('Verifying balances...');

    const result = await withDatabaseAndHandler(VerifyHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('verify', result.error, ExitCodes.GENERAL_ERROR);
      return; // TypeScript needs this even though output.error never returns
    }

    await handleVerifySuccess(output, result.value);
  } catch (error) {
    output.error('verify', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful verification.
 */
async function handleVerifySuccess(output: OutputManager, verifyResult: VerifyResult): Promise<void> {
  // Display results in text mode
  if (output.isTextMode()) {
    output.outro('✨ Verification complete!');
    console.log(''); // Add spacing before results
    displayVerificationResults(verifyResult.results);
  }

  // Save report to file if generated
  let reportPath: string | undefined;
  if (verifyResult.report) {
    reportPath = path.join(process.cwd(), 'data', 'verification-report.md');
    await import('node:fs').then((fs) => fs.promises.writeFile(reportPath!, verifyResult.report!));

    if (output.isTextMode()) {
      console.log(`\n📄 Verification report saved: ${reportPath}`);
    }
  }

  // Prepare result data for JSON mode
  const resultData: VerifyCommandResult = {
    results: verifyResult.results.map((r) => ({
      comparisons: r.comparisons.length,
      matches: r.summary.matches,
      mismatches: r.summary.mismatches,
      source: r.source,
      status: r.status,
      totalCurrencies: r.summary.totalCurrencies,
      warnings: r.summary.warnings,
    })),
  };

  if (reportPath) {
    resultData.reportPath = reportPath;
  }

  output.success('verify', resultData);
  process.exit(0);
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
