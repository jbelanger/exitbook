import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import { createSpinner, stopSpinner } from '../../../shared/spinner.js';
import { LinkActionError, LinkActionResult } from '../../view/index.js';
import { LinksReviewCommandOptionsSchema } from '../links-option-schemas.js';

import { withLinksReviewCommandScope } from './links-review-command-scope.js';
import { type LinksReviewAction, type LinksReviewActionResult } from './links-review-handler.js';
import { runLinksReview } from './run-links-review.js';

type LinksReviewStatus = 'confirmed' | 'rejected';

interface LinksReviewCommandDefinition<TAction extends LinksReviewAction> {
  action: TAction;
  commandName: TAction;
  commandId: `links-${TAction}`;
  description: string;
  newStatus: LinksReviewActionResult<TAction>['newStatus'];
  spinnerText: string;
}

interface LinksReviewCommandJsonResult<TStatus extends LinksReviewStatus> {
  affectedLinkCount: number;
  affectedLinkIds: number[];
  linkId: number;
  newStatus: TStatus;
  reviewedAt: string;
  reviewedBy: string;
}

const LINKS_REVIEW_COMMANDS = {
  confirm: {
    action: 'confirm',
    commandName: 'confirm',
    commandId: 'links-confirm',
    description: 'Confirm a suggested transaction link',
    newStatus: 'confirmed',
    spinnerText: 'Confirming link...',
  },
  reject: {
    action: 'reject',
    commandName: 'reject',
    commandId: 'links-reject',
    description: 'Reject a suggested transaction link',
    newStatus: 'rejected',
    spinnerText: 'Rejecting link...',
  },
} as const satisfies Record<LinksReviewAction, LinksReviewCommandDefinition<LinksReviewAction>>;

export function registerLinksConfirmCommand(linksCommand: Command): void {
  registerLinksReviewCommand(linksCommand, LINKS_REVIEW_COMMANDS.confirm);
}

export function registerLinksRejectCommand(linksCommand: Command): void {
  registerLinksReviewCommand(linksCommand, LINKS_REVIEW_COMMANDS.reject);
}

function registerLinksReviewCommand<TAction extends LinksReviewAction>(
  linksCommand: Command,
  definition: LinksReviewCommandDefinition<TAction>
): void {
  linksCommand
    .command(definition.commandName)
    .description(definition.description)
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links ${definition.commandName} 123
  $ exitbook links ${definition.commandName} 123 --json

Notes:
  - ${capitalize(definition.commandName)}ing a proposal may update multiple related link rows in the same suggestion group.
`
    )
    .argument('<link-id>', `ID of the link to ${definition.commandName}`)
    .option('--json', 'Output results in JSON format')
    .action(async (linkIdArg: string, rawOptions: unknown) => {
      await executeLinksReviewCommand(definition, linkIdArg, rawOptions);
    });
}

async function executeLinksReviewCommand<TAction extends LinksReviewAction>(
  definition: LinksReviewCommandDefinition<TAction>,
  linkIdArg: string,
  rawOptions: unknown
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);
  const spinner = createSpinner(definition.spinnerText, format === 'json');

  try {
    await runCliRuntimeCommand({
      command: definition.commandId,
      format,
      prepare: async () =>
        resultDoAsync(async function* () {
          const linkId = yield* parseLinksReviewLinkIdResult(linkIdArg);
          yield* parseCliCommandOptionsResult(rawOptions, LinksReviewCommandOptionsSchema);
          return linkId;
        }),
      action: async (context) => executeLinksReviewCommandResult(context.runtime, definition, format, context.prepared),
    });
  } finally {
    stopSpinner(spinner);
  }
}

async function executeLinksReviewCommandResult<TAction extends LinksReviewAction>(
  ctx: Parameters<typeof withLinksReviewCommandScope>[0],
  definition: LinksReviewCommandDefinition<TAction>,
  format: CliOutputFormat,
  linkId: number
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = yield* toCliResult(
      await withLinksReviewCommandScope(ctx, async (scope) => {
        const result = await runLinksReview(scope, { linkId }, definition.action);
        if (result.isErr()) {
          if (format !== 'json') {
            renderLinksReviewError(linkId, result.error.message);
          }
          return err(result.error);
        }

        return ok(buildLinksReviewCompletion(definition, format, result.value));
      }),
      ExitCodes.GENERAL_ERROR
    );

    return completion;
  });
}

function parseLinksReviewLinkIdResult(linkIdArg: string): Result<number, CliFailure> {
  const linkId = parseInt(linkIdArg, 10);

  if (!linkIdArg || Number.isNaN(linkId)) {
    return err(createCliFailure(new Error('Link ID must be a valid integer'), ExitCodes.INVALID_ARGS));
  }

  return ok(linkId);
}

function buildLinksReviewCompletion<TAction extends LinksReviewAction>(
  definition: LinksReviewCommandDefinition<TAction>,
  format: CliOutputFormat,
  result: LinksReviewActionResult<TAction>
): CliCompletion {
  const resultData: LinksReviewCommandJsonResult<LinksReviewActionResult<TAction>['newStatus']> = {
    affectedLinkCount: result.affectedLinkCount,
    affectedLinkIds: result.affectedLinkIds,
    linkId: result.linkId,
    newStatus: result.newStatus,
    reviewedAt: result.reviewedAt.toISOString(),
    reviewedBy: result.reviewedBy,
  };

  if (format === 'json') {
    return jsonSuccess(resultData);
  }

  return textSuccess(() => {
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
          action: definition.newStatus,
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
      setTimeout(() => unmount(), 100);
      return;
    }

    console.log(
      `${definition.newStatus === 'confirmed' ? '✓' : '✗'} ${
        result.affectedLinkCount > 1 ? 'Proposal' : 'Link'
      } ${result.linkId} ${definition.newStatus} successfully.`
    );
  });
}

function renderLinksReviewError(linkId: number, message: string): void {
  const { unmount } = render(
    React.createElement(LinkActionError, {
      linkId,
      message,
    })
  );
  setTimeout(() => unmount(), 100);
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
