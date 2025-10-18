import { closeDatabase, initializeDatabase } from '@exitbook/data';
import type { BalanceVerificationResult } from '@exitbook/import';
import type { Command } from 'commander';

import { unwrapResult } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { BalanceHandler } from './balance-handler.ts';
import type { BalanceCommandResult, ExtendedBalanceCommandOptions } from './balance-types.ts';
import { buildBalanceParamsFromFlags } from './balance-utils.ts';

/**
 * Register the balance command.
 */
export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Verify balance by comparing live balance against calculated balance from transactions')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, solana)')
    .option('--address <address>', 'Wallet address (required for blockchain sources)')
    .option('--api-key <key>', 'API key for exchange (overrides .env)')
    .option('--api-secret <secret>', 'API secret for exchange (overrides .env)')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange (if required)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedBalanceCommandOptions) => {
      await executeBalanceCommand(options);
    });
}

/**
 * Execute the balance command.
 */
async function executeBalanceCommand(options: ExtendedBalanceCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  // Initialize database
  const database = await initializeDatabase();
  const handler = new BalanceHandler(database);

  try {
    // Build params from flags (no interactive mode for balance command)
    const params = unwrapResult(buildBalanceParamsFromFlags(options));

    const spinner = output.spinner();
    spinner?.start(`Fetching and verifying balance for ${params.sourceName}...`);

    const result = await handler.execute(params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('balance', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleBalanceSuccess(output, result.value, params.sourceName, params.sourceType, params.address);
  } catch (error) {
    output.error('balance', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  } finally {
    handler.destroy();
    await closeDatabase(database);
  }
}

/**
 * Handle successful balance verification.
 */
function handleBalanceSuccess(
  output: OutputManager,
  verificationResult: BalanceVerificationResult,
  sourceName: string,
  sourceType: 'exchange' | 'blockchain',
  address?: string
) {
  // Display results in text mode
  if (output.isTextMode()) {
    const statusSymbol =
      verificationResult.status === 'success' ? '✓' : verificationResult.status === 'warning' ? '⚠' : '✗';
    output.outro(`${statusSymbol} Balance verification ${verificationResult.status.toUpperCase()} for ${sourceName}`);
    console.log('');

    // Summary
    console.log('Summary:');
    console.log(`  Total currencies: ${verificationResult.summary.totalCurrencies}`);
    console.log(`  Matches: ${verificationResult.summary.matches}`);
    console.log(`  Warnings: ${verificationResult.summary.warnings}`);
    console.log(`  Mismatches: ${verificationResult.summary.mismatches}`);
    console.log('');

    // Show details for each currency
    if (verificationResult.comparisons.length > 0) {
      console.log('Balance Details:');
      for (const comparison of verificationResult.comparisons) {
        const statusIcon = comparison.status === 'match' ? '✓' : comparison.status === 'warning' ? '⚠' : '✗';
        console.log(`  ${statusIcon} ${comparison.currency}:`);
        console.log(`    Live:       ${comparison.liveBalance}`);
        console.log(`    Calculated: ${comparison.calculatedBalance}`);
        if (comparison.status !== 'match') {
          console.log(`    Difference: ${comparison.difference} (${comparison.percentageDiff.toFixed(2)}%)`);
        }
      }
      console.log('');
    }

    // Show suggestion if available
    if (verificationResult.suggestion) {
      console.log(`Suggestion: ${verificationResult.suggestion}`);
      console.log('');
    }
  }

  // Prepare result data for JSON mode
  const resultData: BalanceCommandResult = {
    status: verificationResult.status,
    liveBalances: Object.fromEntries(verificationResult.comparisons.map((c) => [c.currency, c.liveBalance])),
    calculatedBalances: Object.fromEntries(
      verificationResult.comparisons.map((c) => [c.currency, c.calculatedBalance])
    ),
    comparisons: verificationResult.comparisons.map((c) => ({
      currency: c.currency,
      liveBalance: c.liveBalance,
      calculatedBalance: c.calculatedBalance,
      difference: c.difference,
      status: c.status,
    })),
    summary: verificationResult.summary,
    source: {
      type: sourceType,
      name: sourceName,
      address,
    },
    meta: {
      timestamp: new Date(verificationResult.timestamp).toISOString(),
    },
    suggestion: verificationResult.suggestion,
  };

  output.success('balance', resultData);
  // Map status to exit codes: success=0, warning=0, failed=1
  const statusExitCodeMap: Record<string, number> = {
    success: 0,
    warning: 0,
    failed: 1,
  };
  process.exit(statusExitCodeMap[verificationResult.status] ?? 1);
}
