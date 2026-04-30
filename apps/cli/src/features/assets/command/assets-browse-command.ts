import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  executePreparedBrowseCommand,
  prepareBrowseCommand,
  runPreparedBrowseRuntimeCommand,
  type PreparedBrowseCommand,
} from '../../../cli/browse-command-scaffold.js';
import { buildBrowseJsonOrStaticCompletion } from '../../../cli/browse-output.js';
import {
  createCliFailure,
  ExitCodes,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import {
  buildCliOptionsHelpText,
  parseCliBrowseOptionsResult,
  registerCliOptionDefinitions,
  type CliOptionDefinition,
} from '../../../cli/options.js';
import { type BrowseSurfaceSpec } from '../../../cli/presentation.js';
import { buildDefinedFilters } from '../../../cli/view-utils.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
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

interface PrepareAssetsBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

interface ExecuteAssetsBrowseCommandInput extends PrepareAssetsBrowseCommandInput {
  appRuntime: CliAppRuntime;
}

export type PreparedAssetsBrowseCommand = PreparedBrowseCommand<AssetsBrowseParams>;

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

const ASSETS_BROWSE_OPTION_DEFINITIONS: CliOptionDefinition[] = [
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
  return registerCliOptionDefinitions(command, ASSETS_BROWSE_OPTION_DEFINITIONS);
}

export function buildAssetsBrowseOptionsHelpText(): string {
  return buildCliOptionsHelpText(ASSETS_BROWSE_OPTION_DEFINITIONS);
}

export function prepareAssetsBrowseCommand({
  rawOptions,
  selector,
  surfaceSpec,
}: PrepareAssetsBrowseCommandInput): Result<PreparedAssetsBrowseCommand, CliFailure> {
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

  return ok(
    prepareBrowseCommand(
      {
        actionRequiredOnly,
        selector,
        preselectInExplorer: selector !== undefined && presentation.mode === 'tui' ? true : undefined,
      },
      presentation
    )
  );
}

export async function executePreparedAssetsBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedAssetsBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = yield* toCliResult(
      await withAssetsCommandScope(runtime, async (scope) => {
        return executePreparedBrowseCommand({
          prepared,
          loadBrowsePresentation: (params) => buildAssetsBrowsePresentation(scope, params),
          resolveNavigability: (params, browsePresentation) => ({
            hasNavigableItems: browsePresentation.initialState.filteredAssets.length > 0,
            shouldCollapseEmptyExplorer: shouldCollapseAssetsExplorerWhenEmpty(params),
          }),
          buildCompletion: ({ browsePresentation, finalPresentation }) =>
            buildAssetsBrowseCompletion(
              scope,
              browsePresentation,
              finalPresentation.staticKind,
              finalPresentation.mode
            ),
        });
      }),
      ExitCodes.GENERAL_ERROR
    );

    return completion;
  });
}

export async function runAssetsBrowseCommand(input: ExecuteAssetsBrowseCommandInput): Promise<void> {
  await runPreparedBrowseRuntimeCommand({
    appRuntime: input.appRuntime,
    command: input.commandId,
    rawOptions: input.rawOptions,
    prepare: () => prepareAssetsBrowseCommand(input),
    action: async ({ runtime, prepared }) => executePreparedAssetsBrowseCommand(runtime, prepared),
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
  scope: AssetsCommandScope,
  browsePresentation: AssetsBrowsePresentation,
  staticKind: 'detail' | 'list',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, Error> {
  if (mode === 'tui') {
    return ok(
      textSuccess(async () => {
        await renderAssetsBrowseTui(scope, browsePresentation.initialState);
      })
    );
  }

  return buildBrowseJsonOrStaticCompletion({
    createMissingDetailJsonError: () => new Error('Expected an asset detail result'),
    createMissingSelectedItemError: () => new Error('Expected a selected asset'),
    detailJsonResult: browsePresentation.detailJsonResult,
    listJsonResult: browsePresentation.listJsonResult,
    metadata: {
      total: browsePresentation.totalCount,
      actionRequiredCount: browsePresentation.actionRequiredCount,
      excludedCount: browsePresentation.excludedCount,
      filters: buildDefinedFilters({
        actionRequired: browsePresentation.initialState.filter === 'action-required' ? true : undefined,
      }),
    },
    mode,
    renderStaticDetail: (selectedAsset) => {
      outputAssetStaticDetail(selectedAsset);
    },
    renderStaticList: () => {
      outputAssetsStaticList(browsePresentation.initialState);
    },
    selectedItem: browsePresentation.selectedAsset,
    staticKind,
  });
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
