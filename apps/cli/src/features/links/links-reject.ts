// Command registration for links reject subcommand
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { LinksRejectCommandOptionsSchema } from '../shared/schemas.js';
import { createSpinner, stopSpinner } from '../shared/spinner.js';

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

  try {
    const spinner = createSpinner('Rejecting link...', options.json ?? false);

    const { createTransactionQueries, OverrideStore } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const linkRepo = new TransactionLinkRepository(database);
      const txRepo = createTransactionQueries(database);
      const overrideStore = new OverrideStore(ctx.dataDir);

      const handler = new LinksRejectHandler(linkRepo, txRepo, overrideStore);
      const result = await handler.execute({ linkId });

      stopSpinner(spinner);

      if (result.isErr()) {
        if (!options.json) {
          const { unmount } = render(
            React.createElement(LinkActionError, {
              linkId,
              message: result.error.message,
            })
          );
          setTimeout(() => unmount(), 100);
        }

        displayCliError('links-reject', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleLinksRejectSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'links-reject',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

/**
 * Handle successful link rejection.
 */
function handleLinksRejectSuccess(
  isJsonMode: boolean,
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
  }
): void {
  if (!isJsonMode) {
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
      console.log(`✗ Link ${result.linkId} rejected successfully.`);
    }
  }

  const resultData: LinksRejectCommandResult = {
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  if (isJsonMode) {
    outputSuccess('links-reject', resultData);
  }
}
