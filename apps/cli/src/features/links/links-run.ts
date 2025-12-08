import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksRunCommandOptionsSchema } from '../shared/schemas.js';

import type { LinksRunResult } from './links-run-handler.js';
import { LinksRunHandler } from './links-run-handler.js';
import { promptForLinksRunParams } from './links-run-prompts.js';
import { buildLinksRunParamsFromFlags } from './links-run-utils.js';

const logger = getLogger('LinksRunCommand');

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (rawOptions: unknown) => {
      await executeLinksRunCommand(rawOptions);
    });
}

/**
 * Execute the links run command.
 */
async function executeLinksRunCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = LinksRunCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
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

    const result = await withDatabaseAndHandler(LinksRunHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('links-run', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleLinksRunSuccess(output, result.value);
  } catch (error) {
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
    console.log(''); // Add spacing before results
    displayLinkingResults(linkResult);
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

  output.success('links-run', resultData);
  process.exit(0);
}

/**
 * Display linking results in the console.
 */
function displayLinkingResults(result: LinksRunResult): void {
  logger.info('\nTransaction Linking Results');
  logger.info('================================');

  if (result.dryRun) {
    logger.info('Mode: DRY RUN (no changes saved)');
  }

  // Show confirmed links
  if (result.confirmedLinksCount > 0) {
    logger.info(`✓ ${result.confirmedLinksCount} confirmed links (≥95% confidence)`);
  }

  // Show suggested links
  if (result.suggestedLinksCount > 0) {
    logger.info(`⚠ ${result.suggestedLinksCount} suggested links (70-95% confidence)`);
  }

  // Show analysis stats
  logger.info(`ℹ ${result.totalSourceTransactions} sources analyzed`);
  logger.info(`ℹ ${result.totalTargetTransactions} targets analyzed`);

  // Show unmatched counts
  if (result.unmatchedSourceCount > 0) {
    logger.info(`ℹ ${result.unmatchedSourceCount} unmatched sources`);
  }
  if (result.unmatchedTargetCount > 0) {
    logger.info(`ℹ ${result.unmatchedTargetCount} unmatched targets`);
  }

  // Summary
  console.log(''); // Add spacing
  if (result.confirmedLinksCount === 0 && result.suggestedLinksCount === 0) {
    logger.info('No transaction matches found.');
    logger.info('This could mean:');
    logger.info('  • All transfers are already linked');
    logger.info('  • No matching withdrawals/deposits exist');
    logger.info('  • Transactions are outside the matching time window (48 hours)');
  } else if (result.dryRun) {
    logger.info('Dry run complete - no changes saved to database.');
    logger.info('Run without --dry-run to save confirmed links.');
  } else if (result.confirmedLinksCount > 0) {
    logger.info(`Successfully saved ${result.confirmedLinksCount} confirmed links to database.`);
  }

  if (result.suggestedLinksCount > 0) {
    logger.info('\nSuggested links (70-95% confidence) require manual review.');
    logger.info('Use `pnpm run dev links view --status suggested` to review them.');
    logger.info('Use `pnpm run dev links confirm <id>` to confirm a link.');
    logger.info('Use `pnpm run dev links reject <id>` to reject a link.');
  }
}
