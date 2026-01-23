// Command registration for links confirm subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksConfirmCommandOptionsSchema } from '../shared/schemas.js';

import { LinksConfirmHandler } from './links-confirm-handler.js';

/**
 * Command options validated by Zod at CLI boundary
 */
export type LinksConfirmCommandOptions = z.infer<typeof LinksConfirmCommandOptionsSchema>;

/**
 * Result data for links confirm command (JSON mode).
 */
interface LinksConfirmCommandResult {
  linkId: string;
  newStatus: 'confirmed';
  reviewedBy: string;
  reviewedAt: string;
}

/**
 * Register the links confirm subcommand.
 */
export function registerLinksConfirmCommand(linksCommand: Command): void {
  linksCommand
    .command('confirm')
    .description('Confirm a suggested transaction link')
    .argument('<link-id>', 'ID of the link to confirm')
    .option('--json', 'Output results in JSON format')
    .action(async (linkId: string, rawOptions: unknown) => {
      await executeLinksConfirmCommand(linkId, rawOptions);
    });
}

/**
 * Execute the links confirm command.
 */
async function executeLinksConfirmCommand(linkId: string, rawOptions: unknown): Promise<void> {
  // Validate linkId argument
  if (!linkId || linkId.trim() === '') {
    const output = new OutputManager('text');
    output.error('links-confirm', new Error('Link ID is required'), ExitCodes.INVALID_ARGS);
    return;
  }

  // Validate options at CLI boundary
  const parseResult = LinksConfirmCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'links-confirm',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();
    spinner?.start('Confirming link...');

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

    const handler = new LinksConfirmHandler(linkRepo, txRepo);

    const result = await handler.execute({ linkId });

    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to confirm link');
      output.error('links-confirm', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleLinksConfirmSuccess(output, result.value, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('links-confirm', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful link confirmation.
 */
function handleLinksConfirmSuccess(
  output: OutputManager,
  result: { linkId: string; newStatus: 'confirmed'; reviewedAt: Date; reviewedBy: string },
  spinner: ReturnType<OutputManager['spinner']>
): void {
  spinner?.stop('Link confirmed successfully');

  if (output.isTextMode()) {
    console.log('');
    console.log('✓ Link confirmed successfully!');
    console.log(`  Link ID: ${result.linkId}`);
    console.log(`  Status: ${result.newStatus}`);
    console.log(`  Reviewed at: ${result.reviewedAt.toISOString()}`);
    console.log('');
    console.log('This link will now be used for price enrichment and cost basis calculations.');
  }

  const resultData: LinksConfirmCommandResult = {
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  output.json('links-confirm', resultData);
}
