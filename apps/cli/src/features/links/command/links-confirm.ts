// Command registration for links confirm subcommand
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

import { LinksConfirmCommandOptionsSchema } from './links-option-schemas.js';
import { LinksReviewHandler } from './links-review-handler.js';

/**
 * Result data for links confirm command (JSON mode).
 */
interface LinksConfirmCommandResult {
  affectedLinkCount: number;
  affectedLinkIds: number[];
  linkId: number;
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
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--json', 'Output results in JSON format')
    .action(async (linkIdArg: string, rawOptions: unknown) => {
      await executeLinksConfirmCommand(linkIdArg, rawOptions);
    });
}

/**
 * Execute the links confirm command.
 */
async function executeLinksConfirmCommand(linkIdArg: string, rawOptions: unknown): Promise<void> {
  // Validate and parse linkId argument
  const linkId = parseInt(linkIdArg, 10);
  if (!linkIdArg || isNaN(linkId)) {
    displayCliError('links-confirm', new Error('Link ID must be a valid integer'), ExitCodes.INVALID_ARGS, 'text');
  }

  // Validate options at CLI boundary
  const parseResult = LinksConfirmCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'links-confirm',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;

  try {
    const spinner = createSpinner('Confirming link...', options.json ?? false);

    const { OverrideStore } = await import('@exitbook/data/overrides');

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        stopSpinner(spinner);
        displayCliError('links-confirm', profileResult.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      const overrideStore = new OverrideStore(ctx.dataDir);

      const handler = new LinksReviewHandler(
        database,
        profileResult.value.id,
        profileResult.value.profileKey,
        overrideStore
      );
      const result = await handler.executeTyped({ linkId }, 'confirm');

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

        displayCliError('links-confirm', result.error, ExitCodes.GENERAL_ERROR, options.json ? 'json' : 'text');
      }

      handleLinksConfirmSuccess(options.json ?? false, result.value);
    });
  } catch (error) {
    displayCliError(
      'links-confirm',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      options.json ? 'json' : 'text'
    );
  }
}

/**
 * Handle successful link confirmation.
 */
function handleLinksConfirmSuccess(
  isJsonMode: boolean,
  result: {
    affectedLinkCount: number;
    affectedLinkIds: number[];
    asset?: string | undefined;
    confidence?: string | undefined;
    linkId: number;
    newStatus: 'confirmed';
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
          action: 'confirmed',
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
      console.log(`✓ ${result.affectedLinkCount > 1 ? 'Proposal' : 'Link'} ${result.linkId} confirmed successfully.`);
    }
  }

  const resultData: LinksConfirmCommandResult = {
    affectedLinkCount: result.affectedLinkCount,
    affectedLinkIds: result.affectedLinkIds,
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedBy: result.reviewedBy,
    reviewedAt: result.reviewedAt.toISOString(),
  };

  if (isJsonMode) {
    outputSuccess('links-confirm', resultData);
  }
}
