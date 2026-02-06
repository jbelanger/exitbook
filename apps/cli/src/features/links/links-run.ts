import * as p from '@clack/prompts';
import { TransactionLinkRepository } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { TransactionRepository, closeDatabase, initializeDatabase } from '@exitbook/data';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { handleCancellation, isCancelled, promptConfirm } from '../shared/prompts.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

import type { LinksRunHandlerParams, LinksRunResult } from './links-run-handler.js';
import { LinksRunHandler } from './links-run-handler.js';

/**
 * Command options validated by Zod at CLI boundary
 */
type LinksRunCommandOptions = z.infer<typeof LinksRunCommandOptionsSchema>;

/**
 * Build links run parameters from validated CLI options.
 */
function buildLinksRunParamsFromFlags(options: LinksRunCommandOptions): LinksRunHandlerParams {
  return {
    dryRun: options.dryRun ?? false,
    minConfidenceScore: parseDecimal(options.minConfidence?.toString() ?? '0.7'),
    autoConfirmThreshold: parseDecimal(options.autoConfirmThreshold?.toString() ?? '0.95'),
  };
}

/**
 * Prompt user for links run parameters in interactive mode.
 */
async function promptForLinksRunParams(): Promise<LinksRunHandlerParams> {
  // Ask if user wants to run in dry-run mode
  const dryRun = await p.confirm({
    message: 'Run in dry-run mode (preview matches without saving)?',
    initialValue: false,
  });

  if (isCancelled(dryRun)) {
    handleCancellation();
  }

  // Ask for minimum confidence threshold
  const minConfidenceInput = await p.text({
    message: 'Minimum confidence score (0-1, default: 0.7):',
    placeholder: '0.7',
    validate: (value) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
    },
  });

  if (isCancelled(minConfidenceInput)) {
    handleCancellation();
  }

  const minConfidenceScore = parseDecimal(minConfidenceInput ?? '0.7');

  // Ask for auto-confirm threshold
  const autoConfirmInput = await p.text({
    message: 'Auto-confirm threshold (0-1, default: 0.95):',
    placeholder: '0.95',
    validate: (value) => {
      if (!value) return; // Allow empty for default
      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 1) {
        return 'Must be a number between 0 and 1';
      }
      const minConfidence = Number(minConfidenceInput ?? '0.7');
      if (num < minConfidence) {
        return `Must be >= minimum confidence score (${minConfidence})`;
      }
    },
  });

  if (isCancelled(autoConfirmInput)) {
    handleCancellation();
  }

  const autoConfirmThreshold = parseDecimal(autoConfirmInput ?? '0.95');

  return {
    dryRun,
    minConfidenceScore,
    autoConfirmThreshold,
  };
}

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
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    let params: LinksRunHandlerParams;
    if (!options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json) {
      output.intro('exitbook links-run');
      params = await promptForLinksRunParams();
      const shouldProceed = await promptConfirm('Start transaction linking?', true);
      if (!shouldProceed) {
        handleCancellation('Transaction linking cancelled');
      }
    } else {
      params = buildLinksRunParamsFromFlags(options);
    }

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

      await closeDatabase(database);
      spinner?.stop();
      resetLoggerContext();

      if (result.isErr()) {
        output.error('links-run', result.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      handleLinksRunSuccess(output, result.value);
    } catch (error) {
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
