// Command registration for links reject subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { LinksRejectHandler } from './links-reject-handler.ts';

/**
 * Command options for links reject.
 */
export interface LinksRejectCommandOptions {
  json?: boolean | undefined;
}

/**
 * Result data for links reject command (JSON mode).
 */
interface LinksRejectCommandResult {
  linkId: string;
  newStatus: 'rejected';
  reviewedBy: string;
  reviewedAt: string;
}

/**
 * Register the links reject subcommand.
 */
export function registerLinksRejectCommand(linksCommand: Command): void {
  linksCommand
    .command('reject')
    .description('Reject a suggested transaction link')
    .argument('<link-id>', 'ID of the link to reject')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (linkId: string, options: LinksRejectCommandOptions) => {
      await executeLinksRejectCommand(linkId, options);
    });
}

/**
 * Execute the links reject command.
 */
async function executeLinksRejectCommand(linkId: string, options: LinksRejectCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Validate link ID
    if (!linkId || linkId.trim() === '') {
      throw new Error('Link ID is required');
    }

    const spinner = output.spinner();
    spinner?.start('Rejecting link...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    const database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = new TransactionRepository(database);

    const handler = new LinksRejectHandler(linkRepo, txRepo);

    const result = await handler.execute({ linkId });

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to reject link');
      output.error('links-reject', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleLinksRejectSuccess(output, result.value, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('links-reject', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful link rejection.
 */
function handleLinksRejectSuccess(
  output: OutputManager,
  result: { linkId: string; newStatus: 'rejected'; reviewedAt: Date; reviewedBy: string },
  spinner: ReturnType<OutputManager['spinner']>
): void {
  spinner?.stop('Link rejected successfully');

  if (output.isTextMode()) {
    console.log('');
    console.log('✗ Link rejected successfully!');
    console.log(`  Link ID: ${result.linkId}`);
    console.log(`  Status: ${result.newStatus}`);
    console.log(`  Reviewed at: ${result.reviewedAt.toISOString()}`);
    console.log('');
    console.log('This link will be excluded from price enrichment and cost basis calculations.');
  }

  const resultData: LinksRejectCommandResult = {
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  output.success('links-reject', resultData);
  process.exit(0);
}
