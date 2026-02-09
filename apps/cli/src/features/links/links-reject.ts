import path from 'node:path';

// Command registration for links reject subcommand
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { getDataDir } from '../shared/data-dir.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksRejectCommandOptionsSchema } from '../shared/schemas.js';

import { LinkActionError, LinkActionResult } from './components/index.js';
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
    displayCliError('links-reject', new Error('Link ID is required'), ExitCodes.INVALID_ARGS, 'text');
  }

  // Validate options at CLI boundary
  const parseResult = LinksRejectCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-reject',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    const spinner = output.spinner();
    spinner?.start('Rejecting link...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner ?? undefined,
      verbose: false,
      sinks: options.json
        ? { ui: false, structured: 'file' }
        : spinner
          ? { ui: true, structured: 'off' }
          : { ui: false, structured: 'stdout' },
    });

    // Initialize repositories and override store
    const { initializeDatabase, closeDatabase, TransactionRepository, OverrideStore } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    const dataDir = getDataDir();
    const database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = new TransactionRepository(database);
    const overrideStore = new OverrideStore(dataDir);

    const handler = new LinksRejectHandler(linkRepo, txRepo, overrideStore);

    const result = await handler.execute({ linkId });

    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop();

      if (output.isTextMode()) {
        // Render error with Ink
        const { unmount } = render(
          React.createElement(LinkActionError, {
            linkId,
            message: result.error.message,
          })
        );
        setTimeout(() => unmount(), 100);
      }

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
  result: {
    asset?: string | undefined;
    confidence?: string | undefined;
    linkId: string;
    newStatus: 'rejected';
    reviewedAt: Date;
    reviewedBy: string;
    sourceAmount?: string | undefined;
    sourceName?: string | undefined;
    targetAmount?: string | undefined;
    targetName?: string | undefined;
  },
  spinner: ReturnType<OutputManager['spinner']>
): void {
  spinner?.stop();

  if (output.isTextMode()) {
    // Render Ink component for rich display
    if (
      result.asset &&
      result.sourceAmount &&
      result.targetAmount &&
      result.sourceName &&
      result.targetName &&
      result.confidence
    ) {
      const { unmount } = render(
        React.createElement(LinkActionResult, {
          action: 'rejected',
          linkId: result.linkId,
          asset: result.asset,
          sourceAmount: result.sourceAmount,
          targetAmount: result.targetAmount,
          sourceName: result.sourceName,
          targetName: result.targetName,
          confidence: result.confidence,
        })
      );
      // Unmount immediately after rendering (single-line output)
      setTimeout(() => unmount(), 100);
    } else {
      // Fallback for missing data
      console.log(`✗ Link ${result.linkId} rejected successfully`);
    }
  }

  const resultData: LinksRejectCommandResult = {
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  output.json('links-reject', resultData);
}
