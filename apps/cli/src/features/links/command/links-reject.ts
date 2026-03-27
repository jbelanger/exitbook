// Command registration for links reject subcommand
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';
import { LinkActionError, LinkActionResult } from '../view/index.js';

import { LinksRejectCommandOptionsSchema } from './links-option-schemas.js';
import { LinksReviewHandler } from './links-review-handler.js';

/**
 * Result data for links reject command (JSON mode).
 */
interface LinksRejectCommandResult {
  affectedLinkCount: number;
  affectedLinkIds: number[];
  linkId: number;
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
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links reject 123
  $ exitbook links reject 123 --profile business
  $ exitbook links reject 123 --json

Notes:
  - Rejecting a proposal may update multiple related link rows in the same suggestion group.
`
    )
    .argument('<link-id>', 'ID of the link to reject')
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(async (linkIdArg: string, rawOptions: unknown) => {
      await executeLinksRejectCommand(linkIdArg, rawOptions);
    });
}

/**
 * Execute the links reject command.
 */
async function executeLinksRejectCommand(linkIdArg: string, rawOptions: unknown): Promise<void> {
  // Validate and parse linkId argument
  const linkId = parseInt(linkIdArg, 10);
  if (!linkIdArg || isNaN(linkId)) {
    displayCliError('links-reject', new Error('Link ID must be a valid integer'), ExitCodes.INVALID_ARGS, 'text');
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

    const { OverrideStore } = await import('@exitbook/data/overrides');

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        stopSpinner(spinner);
        displayCliError('links-reject', profileResult.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      const overrideStore = new OverrideStore(ctx.dataDir);

      const handler = new LinksReviewHandler(
        database,
        profileResult.value.id,
        profileResult.value.profileKey,
        overrideStore
      );
      const result = await handler.executeTyped({ linkId }, 'reject');

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
    affectedLinkCount: number;
    affectedLinkIds: number[];
    asset?: string | undefined;
    confidence?: string | undefined;
    linkId: number;
    newStatus: 'rejected';
    platformKey?: string | undefined;
    reviewedAt: Date;
    reviewedBy: string;
    sourceAmount?: string | undefined;
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
      result.platformKey &&
      result.targetName &&
      result.confidence
    ) {
      const { unmount } = render(
        React.createElement(LinkActionResult, {
          action: 'rejected',
          affectedLinkCount: result.affectedLinkCount,
          linkId: result.linkId,
          asset: result.asset,
          sourceAmount: result.sourceAmount,
          targetAmount: result.targetAmount,
          platformKey: result.platformKey,
          targetName: result.targetName,
          confidence: result.confidence,
        })
      );
      // Unmount immediately after rendering (single-line output)
      setTimeout(() => unmount(), 100);
    } else {
      // Fallback for missing data
      console.log(`✗ ${result.affectedLinkCount > 1 ? 'Proposal' : 'Link'} ${result.linkId} rejected successfully.`);
    }
  }

  const resultData: LinksRejectCommandResult = {
    affectedLinkCount: result.affectedLinkCount,
    affectedLinkIds: result.affectedLinkIds,
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  if (isJsonMode) {
    outputSuccess('links-reject', resultData);
  }
}
