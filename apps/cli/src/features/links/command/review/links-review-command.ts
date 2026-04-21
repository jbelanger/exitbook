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
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import { createSpinner, stopSpinner } from '../../../shared/spinner.js';
import { getLinkSelectorErrorExitCode } from '../../link-selector.js';
import { LinkActionError, LinkActionResult } from '../../view/index.js';
import { LinksReviewCommandOptionsSchema } from '../links-option-schemas.js';

import { withLinksReviewCommandScope, type LinksReviewCommandScope } from './links-review-command-scope.js';
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
  changed: boolean;
  newStatus: TStatus;
  proposalRef: string;
  reviewedAt: string;
  reviewedBy: string;
}

const LINKS_REVIEW_COMMANDS = {
  confirm: {
    action: 'confirm',
    commandName: 'confirm',
    commandId: 'links-confirm',
    description: 'Confirm a transaction link proposal',
    newStatus: 'confirmed',
    spinnerText: 'Confirming link...',
  },
  reject: {
    action: 'reject',
    commandName: 'reject',
    commandId: 'links-reject',
    description: 'Reject a transaction link proposal',
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
  $ exitbook links ${definition.commandName} a1b2c3d4e5
  $ exitbook links ${definition.commandName} a1b2c3d4e5 --json

Notes:
  - ${capitalize(definition.commandName)}ing a proposal may update multiple related link rows in the same suggestion group.
  - Proposal selectors use the same LINK-REF shown by "links", "links view", and "links explore".
`
    )
    .argument('<proposal-ref>', `Proposal ref to ${definition.commandName}`)
    .option('--json', 'Output results in JSON format')
    .action(async (proposalRefArg: string, rawOptions: unknown) => {
      await executeLinksReviewCommand(definition, proposalRefArg, rawOptions);
    });
}

async function executeLinksReviewCommand<TAction extends LinksReviewAction>(
  definition: LinksReviewCommandDefinition<TAction>,
  proposalRefArg: string,
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
          const proposalRef = yield* parseLinksReviewProposalRefResult(proposalRefArg);
          yield* parseCliCommandOptionsResult(rawOptions, LinksReviewCommandOptionsSchema);
          return proposalRef;
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
  proposalRef: string
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completionResult = await withLinksReviewCommandScope(ctx, async (scope) =>
      executeScopedLinksReview(scope, definition, format, proposalRef)
    );
    if (completionResult.isErr()) {
      return yield* err(createCliFailure(completionResult.error, getLinkSelectorErrorExitCode(completionResult.error)));
    }

    return completionResult.value;
  });
}

function parseLinksReviewProposalRefResult(proposalRefArg: string): Result<string, CliFailure> {
  const proposalRef = proposalRefArg.trim();

  if (proposalRef.length === 0) {
    return err(createCliFailure(new Error('Proposal ref must not be empty'), ExitCodes.INVALID_ARGS));
  }

  return ok(proposalRef);
}

function buildLinksReviewCompletion<TAction extends LinksReviewAction>(
  definition: LinksReviewCommandDefinition<TAction>,
  format: CliOutputFormat,
  result: LinksReviewActionResult<TAction>,
  proposalRef: string
): CliCompletion {
  const resultData: LinksReviewCommandJsonResult<LinksReviewActionResult<TAction>['newStatus']> = {
    affectedLinkCount: result.affectedLinkCount,
    affectedLinkIds: result.affectedLinkIds,
    changed: result.changed,
    newStatus: result.newStatus,
    proposalRef,
    reviewedAt: result.reviewedAt.toISOString(),
    reviewedBy: result.reviewedBy,
  };

  if (format === 'json') {
    return jsonSuccess(resultData);
  }

  return textSuccess(() => {
    if (!result.changed) {
      console.log(`Proposal ${proposalRef} was already ${definition.newStatus}.`);
      return;
    }

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
          proposalRef,
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
      `${definition.newStatus === 'confirmed' ? '✓' : '✗'} Proposal ${proposalRef} ${definition.newStatus} successfully.`
    );
  });
}

async function executeScopedLinksReview<TAction extends LinksReviewAction>(
  scope: LinksReviewCommandScope,
  definition: LinksReviewCommandDefinition<TAction>,
  format: CliOutputFormat,
  proposalRef: string
): Promise<Result<CliCompletion, Error>> {
  const resolvedProposalResult = await scope.resolveProposalRef(proposalRef);
  if (resolvedProposalResult.isErr()) {
    return err(resolvedProposalResult.error);
  }

  const resolvedProposal = resolvedProposalResult.value;
  const result = await runLinksReview(scope, { linkId: resolvedProposal.representativeLinkId }, definition.action);
  if (result.isErr()) {
    if (format !== 'json') {
      renderLinksReviewError(result.error.message);
    }
    return err(result.error);
  }

  return ok(buildLinksReviewCompletion(definition, format, result.value, resolvedProposal.proposalRef));
}

function renderLinksReviewError(message: string): void {
  const { unmount } = render(
    React.createElement(LinkActionError, {
      message,
    })
  );
  setTimeout(() => unmount(), 100);
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
