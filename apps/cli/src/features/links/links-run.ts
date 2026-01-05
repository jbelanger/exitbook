import { TransactionLinkRepository } from '@exitbook/accounting';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { resolveCommandParams, unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

import type { LinksRunResult } from './links-run-handler.js';
import { LinksRunHandler } from './links-run-handler.js';
import { promptForLinksRunParams } from './links-run-prompts.js';
import { buildLinksRunParamsFromFlags } from './links-run-utils.js';

/**
 * Command options validated by Zod at CLI boundary
 */
export type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Link run command result data.
 */
interface LinksRunCommandResult {
  confirmedLinksCount: number;
  suggestedLinksCount: number;
  totalSourceTransactions: number;
  totalTargetTransactions: number;
  unmatchedSourceCount: number;
  unmatchedTargetCount: number;
  dryRun: boolean;
}

/**
 * Register the links run subcommand.
 */
export function registerLinksRunCommand(linksCommand: Command): void {
  linksCommand
    .command('run')
    .description('Run the linking algorithm to find matching transactions across sources')
    .option('--dry-run', 'Show matches without saving to database')
    .option('--min-confidence <score>', 'Minimum confidence threshold (0-1, default: 0.7)', parseFloat)
    .option('--auto-confirm-threshold <score>', 'Auto-confirm above this score (0-1, default: 0.95)', parseFloat)
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksRunCommand(rawOptions);
    });
}

/**
 * Execute the links run command.
 */
async function executeLinksRunCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary
  const parseResult = LinksRunCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    output.error(
      'links-run',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildLinksRunParamsFromFlags(options)),
      cancelMessage: 'Transaction linking cancelled',
      commandName: 'links-run',
      confirmMessage: 'Start transaction linking?',
      isInteractive: !options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json,
      output,
      promptFn: promptForLinksRunParams,
    });

    const spinner = output.spinner();
    spinner?.start('Linking transactions...');

    // Configure logger if no spinner (JSON mode)
    if (!spinner) {
      configureLogger({
        mode: options.json ? 'json' : 'text',
        verbose: false,
        sinks: options.json ? { ui: false, structured: 'file' } : { ui: false, structured: 'stdout' },
      });
    }

    const database = await initializeDatabase();
    const transactionRepository = new TransactionRepository(database);
    const linkRepository = new TransactionLinkRepository(database);
    const handler = new LinksRunHandler(transactionRepository, linkRepository);

    try {
      const result = await handler.execute(params);

      handler.destroy();
      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('links-run', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleLinksRunSuccess(output, result.value);
    } catch (error) {
      handler.destroy();
      await closeDatabase(database);
      spinner?.stop('Linking failed');
      resetLoggerContext();
      throw error;
    }
  } catch (error) {
    resetLoggerContext();
    output.error('links-run', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful linking.
 */
function handleLinksRunSuccess(output: OutputManager, linkResult: LinksRunResult): void {
  // Display results in text mode
  if (output.isTextMode()) {
    output.outro(linkResult.dryRun ? '✨ Linking preview complete!' : '✨ Transaction linking complete!');
    displayLinkingResults(linkResult, output);
  }

  // Prepare result data for JSON mode
  const resultData: LinksRunCommandResult = {
    confirmedLinksCount: linkResult.confirmedLinksCount,
    suggestedLinksCount: linkResult.suggestedLinksCount,
    totalSourceTransactions: linkResult.totalSourceTransactions,
    totalTargetTransactions: linkResult.totalTargetTransactions,
    unmatchedSourceCount: linkResult.unmatchedSourceCount,
    unmatchedTargetCount: linkResult.unmatchedTargetCount,
    dryRun: linkResult.dryRun,
  };

  output.json('links-run', resultData);
  process.exit(0);
}

/**
 * Display linking results in the console.
 */
function displayLinkingResults(result: LinksRunResult, output: OutputManager): void {
  output.log('');
  output.log('Transaction Linking Summary:');

  // Build summary table
  const rows: { label: string; value: string }[] = [
    { label: 'Sources analyzed', value: result.totalSourceTransactions.toString() },
    { label: 'Targets analyzed', value: result.totalTargetTransactions.toString() },
    { label: 'Confirmed links', value: result.confirmedLinksCount.toString() },
    { label: 'Suggested links', value: result.suggestedLinksCount.toString() },
    { label: 'Unmatched sources', value: result.unmatchedSourceCount.toString() },
    { label: 'Unmatched targets', value: result.unmatchedTargetCount.toString() },
  ];

  // Calculate column widths
  const labelWidth = Math.max(16, ...rows.map((r) => r.label.length));
  const valueWidth = Math.max(5, ...rows.map((r) => r.value.length));

  // Print table
  const headerLine = `┌─${'─'.repeat(labelWidth)}─┬─${'─'.repeat(valueWidth)}─┐`;
  const separatorLine = `├─${'─'.repeat(labelWidth)}─┼─${'─'.repeat(valueWidth)}─┤`;
  const footerLine = `└─${'─'.repeat(labelWidth)}─┴─${'─'.repeat(valueWidth)}─┘`;

  output.log(headerLine);
  output.log(`│ ${'Metric'.padEnd(labelWidth)} │ ${'Count'.padEnd(valueWidth)} │`);
  output.log(separatorLine);

  for (const row of rows) {
    output.log(`│ ${row.label.padEnd(labelWidth)} │ ${row.value.padEnd(valueWidth)} │`);
  }

  output.log(footerLine);
  output.log('');

  // Additional context
  if (result.dryRun) {
    output.log('Mode: DRY RUN (no changes saved)');
    output.log('');
  }

  if (result.confirmedLinksCount === 0 && result.suggestedLinksCount === 0) {
    output.log('No transaction matches found.');
    output.log('This could mean:');
    output.log('  • All transfers are already linked');
    output.log('  • No matching withdrawals/deposits exist');
    output.log('  • Transactions are outside the matching time window (48 hours)');
    output.log('');
  } else {
    // Show what was saved
    if (!result.dryRun && result.confirmedLinksCount > 0) {
      output.log(`✓ Saved ${result.confirmedLinksCount} confirmed links (≥95% confidence)`);
    } else if (result.dryRun && result.confirmedLinksCount > 0) {
      output.log(`  ${result.confirmedLinksCount} confirmed links (≥95% confidence) - NOT SAVED (dry run)`);
    }

    if (result.suggestedLinksCount > 0) {
      output.log(`⚠ ${result.suggestedLinksCount} suggested links (70-95% confidence) need manual review`);
      output.log('');
      output.log('Next steps:');
      output.log('  • View suggested links: pnpm run dev links view --status suggested');
      output.log('  • Confirm a link: pnpm run dev links confirm <id>');
      output.log('  • Reject a link: pnpm run dev links reject <id>');
    }
    output.log('');
  }
}
