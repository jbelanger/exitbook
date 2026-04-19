import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { buildDefinedFilters } from '../../../cli/view-utils.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { outputAssetStaticDetail, outputAssetsStaticList } from '../view/assets-static-renderer.js';
import { AssetsViewApp } from '../view/assets-view-components.jsx';
import { createAssetsViewState, type AssetsViewFilter } from '../view/assets-view-state.js';

import type { AssetsCommandScope } from './assets-command-scope.js';
import { withAssetsCommandScope } from './assets-command-scope.js';
import { AssetsBrowseCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetViewItem } from './assets-types.js';
import {
  runAssetsBrowse,
  runAssetsClearReview,
  runAssetsConfirmReview,
  runAssetsExclude,
  runAssetsInclude,
} from './run-assets.js';

interface ExecuteAssetsBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

export interface PreparedAssetsBrowseCommand {
  params: AssetsBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface AssetsBrowseParams {
  actionRequiredOnly?: boolean | undefined;
  preselectInExplorer?: boolean | undefined;
  selector?: string | undefined;
}

interface AssetsBrowsePresentation {
  actionRequiredCount: number;
  detailJsonResult?: Record<string, unknown> | undefined;
  excludedCount: number;
  initialState: ReturnType<typeof createAssetsViewState>;
  listJsonResult: {
    assets: AssetViewItem[];
  };
  selectedAsset?: AssetViewItem | undefined;
  totalCount: number;
}

interface AssetsBrowseOptionDefinition {
  description: string;
  flags: string;
}

const ASSETS_BROWSE_OPTION_DEFINITIONS: AssetsBrowseOptionDefinition[] = [
  {
    flags: '--action-required',
    description: 'Show only flagged assets that still need attention',
  },
  {
    flags: '--needs-review',
    description: 'Alias for --action-required',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerAssetsBrowseOptions(command: Command): Command {
  for (const option of ASSETS_BROWSE_OPTION_DEFINITIONS) {
    command.option(option.flags, option.description);
  }

  return command;
}

export function buildAssetsBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    ASSETS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return ASSETS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export function prepareAssetsBrowseCommand({
  rawOptions,
  selector,
  surfaceSpec,
}: ExecuteAssetsBrowseCommandInput): Result<PreparedAssetsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(rawOptions, AssetsBrowseCommandOptionsSchema, surfaceSpec);
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { options, presentation } = parsedOptionsResult.value;
  const actionRequiredOnly = options.actionRequired || options.needsReview;
  if (selector && actionRequiredOnly) {
    return err(
      createCliFailure(
        new Error('Asset selector cannot be combined with --action-required or --needs-review'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      actionRequiredOnly,
      selector,
      preselectInExplorer: selector !== undefined && presentation.mode === 'tui' ? true : undefined,
    },
    presentation,
  });
}

export async function executePreparedAssetsBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedAssetsBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = yield* toCliResult(
      await withAssetsCommandScope(runtime, async (scope) => {
        const browsePresentationResult = await buildAssetsBrowsePresentation(scope, prepared.params);
        if (browsePresentationResult.isErr()) {
          return err(browsePresentationResult.error);
        }

        const browsePresentation = browsePresentationResult.value;
        const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
          hasNavigableItems: browsePresentation.initialState.filteredAssets.length > 0,
          shouldCollapseEmptyExplorer: shouldCollapseAssetsExplorerWhenEmpty(prepared.params),
        });

        if (finalPresentation.mode === 'tui') {
          await renderAssetsBrowseTui(scope, browsePresentation.initialState);
          return ok(silentSuccess());
        }

        return buildAssetsBrowseCompletion(browsePresentation, finalPresentation.staticKind, finalPresentation.mode);
      }),
      ExitCodes.GENERAL_ERROR
    );

    return completion;
  });
}

export async function runAssetsBrowseCommand(input: ExecuteAssetsBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () => prepareAssetsBrowseCommand(input),
    action: async (context) => executePreparedAssetsBrowseCommand(context.runtime, context.prepared),
  });
}

async function buildAssetsBrowsePresentation(
  scope: AssetsCommandScope,
  params: AssetsBrowseParams
): Promise<Result<AssetsBrowsePresentation, Error>> {
  const browseResult = await runAssetsBrowse(scope, {
    actionRequiredOnly: params.actionRequiredOnly,
    selector: params.selector,
  });
  if (browseResult.isErr()) {
    return err(browseResult.error);
  }

  const initialFilter: AssetsViewFilter = params.actionRequiredOnly ? 'action-required' : 'default';
  const initialState = createAssetsViewState(
    browseResult.value.allAssets,
    {
      actionRequiredCount: browseResult.value.actionRequiredCount,
      excludedCount: browseResult.value.excludedCount,
      totalCount: browseResult.value.totalCount,
    },
    initialFilter,
    params.preselectInExplorer ? browseResult.value.selectedAsset?.assetId : undefined
  );

  return ok({
    actionRequiredCount: browseResult.value.actionRequiredCount,
    excludedCount: browseResult.value.excludedCount,
    totalCount: browseResult.value.totalCount,
    initialState,
    selectedAsset: browseResult.value.selectedAsset,
    listJsonResult: {
      assets: browseResult.value.assets,
    },
    detailJsonResult: browseResult.value.selectedAsset
      ? serializeAssetDetailItem(browseResult.value.selectedAsset)
      : undefined,
  });
}

function buildAssetsBrowseCompletion(
  browsePresentation: AssetsBrowsePresentation,
  staticKind: 'detail' | 'list',
  mode: 'json' | 'static'
): Result<CliCompletion, Error> {
  switch (mode) {
    case 'json':
      if (staticKind === 'detail') {
        if (!browsePresentation.detailJsonResult) {
          return err(new Error('Expected an asset detail result'));
        }

        return ok(jsonSuccess(browsePresentation.detailJsonResult));
      }

      return ok(
        jsonSuccess(browsePresentation.listJsonResult, {
          total: browsePresentation.totalCount,
          actionRequiredCount: browsePresentation.actionRequiredCount,
          excludedCount: browsePresentation.excludedCount,
          filters: buildDefinedFilters({
            actionRequired: browsePresentation.initialState.filter === 'action-required' ? true : undefined,
          }),
        })
      );
    case 'static':
      if (staticKind === 'detail') {
        if (!browsePresentation.selectedAsset) {
          return err(new Error('Expected a selected asset'));
        }
        const selectedAsset = browsePresentation.selectedAsset;

        return ok(
          textSuccess(() => {
            outputAssetStaticDetail(selectedAsset);
          })
        );
      }

      return ok(
        textSuccess(() => {
          outputAssetsStaticList(browsePresentation.initialState);
        })
      );
  }
}

async function renderAssetsBrowseTui(
  scope: AssetsCommandScope,
  initialState: ReturnType<typeof createAssetsViewState>
): Promise<void> {
  await renderApp((unmount) =>
    React.createElement(AssetsViewApp, {
      initialState,
      onQuit: unmount,
      onToggleExclusion: async (assetId, excluded) => {
        const actionResult = excluded
          ? await runAssetsInclude(scope, { assetId })
          : await runAssetsExclude(scope, { assetId });
        if (actionResult.isErr()) {
          throw actionResult.error;
        }
        return actionResult.value;
      },
      onConfirmReview: async (assetId) => {
        const actionResult = await runAssetsConfirmReview(scope, { assetId });
        if (actionResult.isErr()) {
          throw actionResult.error;
        }
        return actionResult.value;
      },
      onClearReview: async (assetId) => {
        const actionResult = await runAssetsClearReview(scope, { assetId });
        if (actionResult.isErr()) {
          throw actionResult.error;
        }
        return actionResult.value;
      },
    })
  );
}

function serializeAssetDetailItem(asset: AssetViewItem): Record<string, unknown> {
  return { ...asset };
}

function shouldCollapseAssetsExplorerWhenEmpty(params: AssetsBrowseParams): boolean {
  return params.selector === undefined && params.actionRequiredOnly === undefined;
}
