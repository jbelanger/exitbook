import { getLogger } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { resolveCommandParams, unwrapResult, withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import type { LinkResult } from './link-handler.ts';
import { LinkHandler } from './link-handler.ts';
import { promptForLinkParams } from './link-prompts.ts';
import type { LinkCommandOptions } from './link-utils.ts';
import { buildLinkParamsFromFlags } from './link-utils.ts';

const logger = getLogger('LinkCommand');

/**
 * Extended link command options (adds CLI-specific flags not needed by handler).
 */
export interface ExtendedLinkCommandOptions extends LinkCommandOptions {
  json?: boolean | undefined;
}

/**
 * Link command result data.
 */
interface LinkCommandResult {
  confirmedLinksCount: number;
  suggestedLinksCount: number;
  totalSourceTransactions: number;
  totalTargetTransactions: number;
  unmatchedSourceCount: number;
  unmatchedTargetCount: number;
  dryRun: boolean;
}

/**
 * Register the link command.
 */
export function registerLinkCommand(program: Command): void {
  program
    .command('link')
    .description('Link related transactions (withdrawals to deposits) across all sources')
    .option('--dry-run', 'Show matches without saving to database')
    .option('--min-confidence <score>', 'Minimum confidence threshold (0-1, default: 0.7)')
    .option('--auto-confirm-threshold <score>', 'Auto-confirm above this score (0-1, default: 0.95)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedLinkCommandOptions) => {
      await executeLinkCommand(options);
    });
}

/**
 * Execute the link command.
 */
async function executeLinkCommand(options: ExtendedLinkCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const params = await resolveCommandParams({
      buildFromFlags: () => unwrapResult(buildLinkParamsFromFlags(options)),
      cancelMessage: 'Transaction linking cancelled',
      commandName: 'link',
      confirmMessage: 'Start transaction linking?',
      isInteractive: !options.dryRun && !options.minConfidence && !options.autoConfirmThreshold && !options.json,
      output,
      promptFn: promptForLinkParams,
    });

    const spinner = output.spinner();
    spinner?.start('Linking transactions...');

    const result = await withDatabaseAndHandler(LinkHandler, params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('link', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleLinkSuccess(output, result.value);
  } catch (error) {
    output.error('link', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful linking.
 */
function handleLinkSuccess(output: OutputManager, linkResult: LinkResult): void {
  // Display results in text mode
  if (output.isTextMode()) {
    output.outro(linkResult.dryRun ? '✨ Linking preview complete!' : '✨ Transaction linking complete!');
    console.log(''); // Add spacing before results
    displayLinkingResults(linkResult);
  }

  // Prepare result data for JSON mode
  const resultData: LinkCommandResult = {
    confirmedLinksCount: linkResult.confirmedLinksCount,
    suggestedLinksCount: linkResult.suggestedLinksCount,
    totalSourceTransactions: linkResult.totalSourceTransactions,
    totalTargetTransactions: linkResult.totalTargetTransactions,
    unmatchedSourceCount: linkResult.unmatchedSourceCount,
    unmatchedTargetCount: linkResult.unmatchedTargetCount,
    dryRun: linkResult.dryRun,
  };

  output.success('link', resultData);
  process.exit(0);
}

/**
 * Display linking results in the console.
 */
function displayLinkingResults(result: LinkResult): void {
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
    logger.info('A manual review interface will be available in a future update.');
  }
}
