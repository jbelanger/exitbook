// Command registration for links confirm subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import { LinksConfirmHandler } from './links-confirm-handler.js';

/**
 * Command options for links confirm.
 */
export interface LinksConfirmCommandOptions {
  json?: boolean | undefined;
}

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (linkId: string, options: LinksConfirmCommandOptions) => {
      await executeLinksConfirmCommand(linkId, options);
    });
}

/**
 * Execute the links confirm command.
 */
async function executeLinksConfirmCommand(linkId: string, options: LinksConfirmCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Validate link ID
    if (!linkId || linkId.trim() === '') {
      throw new Error('Link ID is required');
    }

    const spinner = output.spinner();
    spinner?.start('Confirming link...');

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

    const handler = new LinksConfirmHandler(linkRepo, txRepo);

    const result = await handler.execute({ linkId });

    handler.destroy();
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

  output.success('links-confirm', resultData);
  process.exit(0);
}
