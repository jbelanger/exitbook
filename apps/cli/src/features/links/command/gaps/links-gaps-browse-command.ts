import { OverrideStore, readResolvedLinkGapTxFingerprints } from '@exitbook/data/overrides';
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
} from '../../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../../cli/presentation.js';
import { loadAccountingExclusionPolicy } from '../../../../runtime/accounting-exclusion-policy.js';
import { renderApp, type CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { getLinkSelectorErrorExitCode } from '../../link-selector.js';
import { LinksViewApp } from '../../view/index.js';
import { buildLinksGapsBrowseCompletion, hasNavigableLinksGapsBrowseItems } from '../links-gaps-browse-output.js';
import {
  buildLinksGapsBrowsePresentation,
  type LinksGapsBrowseParams,
  type LinksGapsBrowsePresentation,
} from '../links-gaps-browse-support.js';
import { LinksGapsBrowseCommandOptionsSchema } from '../links-option-schemas.js';

export interface PreparedLinksGapsBrowseCommand {
  params: LinksGapsBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface ExecuteLinksGapsBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

export function registerLinksGapsBrowseOptions(command: Command): Command {
  return command.option('--json', 'Output JSON format');
}

export function prepareLinksGapsBrowseCommand(
  input: ExecuteLinksGapsBrowseCommandInput
): Result<PreparedLinksGapsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(
    input.rawOptions,
    LinksGapsBrowseCommandOptionsSchema,
    input.surfaceSpec
  );
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const selector = input.selector?.trim();

  return ok({
    params: {
      preselectInExplorer:
        selector !== undefined && parsedOptionsResult.value.presentation.mode === 'tui' ? true : undefined,
      selector,
    },
    presentation: parsedOptionsResult.value.presentation,
  });
}

export async function executePreparedLinksGapsBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedLinksGapsBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profile = yield* toCliResult(await resolveCommandProfile(runtime, database), ExitCodes.GENERAL_ERROR);
    const accountingExclusionPolicy = yield* toCliResult(
      await loadAccountingExclusionPolicy(runtime.dataDir, profile.profileKey),
      ExitCodes.GENERAL_ERROR
    );
    const overrideStore = new OverrideStore(runtime.dataDir);
    const resolvedTransactionFingerprints = yield* toCliResult(
      await readResolvedLinkGapTxFingerprints(overrideStore, profile.profileKey),
      ExitCodes.GENERAL_ERROR
    );

    const browsePresentationResult = await buildLinksGapsBrowsePresentation(
      database,
      profile.id,
      prepared.params,
      accountingExclusionPolicy.excludedAssetIds,
      resolvedTransactionFingerprints
    );
    const browsePresentation = browsePresentationResult.isErr()
      ? yield* err(
          createCliFailure(browsePresentationResult.error, getLinkSelectorErrorExitCode(browsePresentationResult.error))
        )
      : browsePresentationResult.value;
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: hasNavigableLinksGapsBrowseItems(browsePresentation),
      shouldCollapseEmptyExplorer: prepared.params.selector === undefined,
    });

    if (finalPresentation.mode === 'tui') {
      yield* toCliResult(await renderLinksGapsExploreTui(runtime, browsePresentation), ExitCodes.GENERAL_ERROR);
      return silentSuccess();
    }

    return yield* toCliResult(
      buildLinksGapsBrowseCompletion(
        browsePresentation,
        finalPresentation.staticKind,
        finalPresentation.mode === 'json' ? 'json' : 'static',
        prepared.params
      ),
      ExitCodes.GENERAL_ERROR
    );
  });
}

export async function runLinksGapsBrowseCommand(input: ExecuteLinksGapsBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () => prepareLinksGapsBrowseCommand(input),
    action: async (context) => executePreparedLinksGapsBrowseCommand(context.runtime, context.prepared),
  });
}

async function renderLinksGapsExploreTui(
  runtime: CommandRuntime,
  browsePresentation: LinksGapsBrowsePresentation
): Promise<Result<void, Error>> {
  try {
    await runtime.closeDatabase();
    await renderApp((unmount) =>
      React.createElement(LinksViewApp, {
        initialState: browsePresentation.state,
        onQuit: unmount,
      })
    );

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
