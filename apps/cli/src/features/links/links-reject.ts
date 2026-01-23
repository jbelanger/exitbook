// Command registration for links reject subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksRejectCommandOptionsSchema } from '../shared/schemas.js';

import { LinksRejectHandler } from './links-reject-handler.js';

/**
 * Command options validated by Zod at CLI boundary
 */
export type LinksRejectCommandOptions = z.infer<typeof LinksRejectCommandOptionsSchema>;

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
    .option('--json', 'Output results in JSON format')
    .action(async (linkId: string, rawOptions: unknown) => {
      await executeLinksRejectCommand(linkId, rawOptions);
    });
}

/**
 * Execute the links reject command.
 */
async function executeLinksRejectCommand(linkId: string, rawOptions: unknown): Promise<void> {
  // Validate linkId argument
  if (!linkId || linkId.trim() === '') {
    const output = new OutputManager('text');
    output.error('links-reject', new Error('Link ID is required'), ExitCodes.INVALID_ARGS);
    return;
  }

  // Validate options at CLI boundary
  const parseResult = LinksRejectCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'links-reject',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();
    spinner?.start('Rejecting link...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
      sinks: options.json
        ? { ui: false, structured: 'file' }
        : spinner
          ? { ui: true, structured: 'off' }
          : { ui: false, structured: 'stdout' },
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    const database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = new TransactionRepository(database);

    const handler = new LinksRejectHandler(linkRepo, txRepo);

    const result = await handler.execute({ linkId });

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

  output.json('links-reject', resultData);
}
