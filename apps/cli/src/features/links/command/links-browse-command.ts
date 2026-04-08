import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  runCliRuntimeCommand,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { getLinkSelectorErrorExitCode } from '../link-selector.js';
import { LinksViewApp } from '../view/index.js';

import { buildLinksBrowseCompletion, hasNavigableLinksBrowseItems } from './links-browse-output.js';
import {
  buildLinksBrowsePresentation,
  type LinksBrowseParams,
  type LinksBrowsePresentation,
} from './links-browse-support.js';
import { LinksBrowseCommandOptionsSchema } from './links-option-schemas.js';
import { LinksReviewHandler } from './review/links-review-handler.js';

export interface PreparedLinksBrowseCommand {
  params: LinksBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface ExecuteLinksBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

interface LinksBrowseOptionDefinition {
  description: string;
  flags: string;
  parser?: (value: string) => unknown;
}

const LINKS_BROWSE_OPTION_DEFINITIONS: LinksBrowseOptionDefinition[] = [
  {
    flags: '--status <status>',
    description: 'Filter proposals by status (suggested, confirmed, rejected)',
  },
  {
    flags: '--gaps',
    description: 'Show coverage gaps instead of link proposals',
  },
  {
    flags: '--min-confidence <score>',
    description: 'Filter proposals by minimum confidence score (0-1)',
    parser: parseFloat,
  },
  {
    flags: '--max-confidence <score>',
    description: 'Filter proposals by maximum confidence score (0-1)',
    parser: parseFloat,
  },
  {
    flags: '--verbose',
    description: 'Include full transaction details in proposal detail surfaces',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerLinksBrowseOptions(command: Command): Command {
  for (const option of LINKS_BROWSE_OPTION_DEFINITIONS) {
    if (option.parser) {
      command.option(option.flags, option.description, option.parser);
      continue;
    }

    command.option(option.flags, option.description);
  }

  return command;
}

export function buildLinksBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    LINKS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return LINKS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export function prepareLinksBrowseCommand(
  input: ExecuteLinksBrowseCommandInput
): Result<PreparedLinksBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(
    input.rawOptions,
    LinksBrowseCommandOptionsSchema,
    input.surfaceSpec
  );
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { options, presentation } = parsedOptionsResult.value;
  const selector = input.selector?.trim();

  if (
    selector &&
    (options.status !== undefined || options.minConfidence !== undefined || options.maxConfidence !== undefined)
  ) {
    return err(
      createCliFailure(
        new Error(
          'Link selector cannot be combined with --status, --min-confidence, or --max-confidence; use the selector alone or browse the filtered list first'
        ),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      gaps: options.gaps,
      maxConfidence: options.maxConfidence,
      minConfidence: options.minConfidence,
      preselectInExplorer: selector !== undefined && presentation.mode === 'tui' ? true : undefined,
      selector,
      status: options.status,
      verbose: options.verbose,
    },
    presentation,
  });
}

export async function runLinksBrowseCommand(input: ExecuteLinksBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () => prepareLinksBrowseCommand(input),
    action: async (context) => executePreparedLinksBrowseCommand(context.runtime, context.prepared),
  });
}

export async function executePreparedLinksBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedLinksBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, database), ExitCodes.GENERAL_ERROR);
    const browsePresentationResult = await buildLinksBrowsePresentation(database, profile.id, prepared.params);
    const browsePresentation = browsePresentationResult.isErr()
      ? yield* err(
          createCliFailure(browsePresentationResult.error, getLinkSelectorErrorExitCode(browsePresentationResult.error))
        )
      : browsePresentationResult.value;
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: hasNavigableLinksBrowseItems(browsePresentation),
      shouldCollapseEmptyExplorer: prepared.params.selector === undefined,
    });

    if (finalPresentation.mode === 'tui') {
      yield* toCliResult(
        await renderLinksExploreTui(runtime, database, profile, browsePresentation),
        ExitCodes.GENERAL_ERROR
      );
      return silentSuccess();
    }

    return yield* toCliResult(
      buildLinksBrowseCompletion(
        browsePresentation,
        finalPresentation.staticKind,
        finalPresentation.mode === 'json' ? 'json' : 'static',
        prepared.params
      ),
      ExitCodes.GENERAL_ERROR
    );
  });
}

async function renderLinksExploreTui(
  runtime: CommandRuntime,
  database: Awaited<ReturnType<CommandRuntime['database']>>,
  profile: { id: number; profileKey: string },
  browsePresentation: LinksBrowsePresentation
): Promise<Result<void, Error>> {
  try {
    if (browsePresentation.mode === 'gaps') {
      await runtime.closeDatabase();
      await renderApp((unmount) =>
        React.createElement(LinksViewApp, {
          initialState: browsePresentation.state,
          onQuit: unmount,
        })
      );

      return ok(undefined);
    }

    const reviewHandler = new LinksReviewHandler(
      database as never,
      profile.id,
      profile.profileKey,
      new OverrideStore(runtime.dataDir)
    );

    await renderApp((unmount) =>
      React.createElement(LinksViewApp, {
        initialState: browsePresentation.state,
        onAction: async (linkId, action) => {
          const result = await reviewHandler.execute({ linkId }, action);
          if (result.isErr()) {
            throw result.error;
          }

          return {
            affectedLinkIds: result.value.affectedLinkIds,
            newStatus: result.value.newStatus,
          };
        },
        onQuit: unmount,
      })
    );

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
