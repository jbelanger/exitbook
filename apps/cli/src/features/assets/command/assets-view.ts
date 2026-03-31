import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { renderApp } from '../../../runtime/command-runtime.js';
import { runCliRuntimeAction, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import {
  jsonSuccess,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
} from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { buildViewMeta, type ViewCommandResult } from '../../shared/view-utils.js';
import { AssetsViewApp } from '../view/assets-view-components.jsx';
import { createAssetsViewState } from '../view/assets-view-state.js';

import type { AssetsCommandScope } from './assets-command-scope.js';
import { withAssetsCommandScope } from './assets-command-scope.js';
import { AssetsViewCommandOptionsSchema } from './assets-option-schemas.js';
import type { AssetViewItem } from './assets-types.js';
import {
  runAssetsClearReview,
  runAssetsConfirmReview,
  runAssetsExclude,
  runAssetsInclude,
  runAssetsView,
} from './run-assets.js';

type AssetsViewCommandOptions = z.infer<typeof AssetsViewCommandOptionsSchema>;

type ViewAssetsCommandResult = ViewCommandResult<AssetViewItem[]>;

export function registerAssetsViewCommand(assetsCommand: Command): void {
  assetsCommand
    .command('view')
    .description('View assets and review flagged ones')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook assets view
  $ exitbook assets view --action-required
  $ exitbook assets view --needs-review

Notes:
  - --needs-review is an alias for --action-required.
`
    )
    .option('--action-required', 'Show only flagged assets that still need attention')
    .option('--needs-review', 'Alias for --action-required')
    .option('--json', 'Output results in JSON format')
    .action((rawOptions: unknown) => executeAssetsViewCommand(rawOptions));
}

async function executeAssetsViewCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliCommandBoundary({
    command: 'assets-view',
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, AssetsViewCommandOptionsSchema);
        return yield* await executeAssetsViewCommandResult(options, format);
      }),
  });
}

async function executeAssetsViewCommandResult(
  options: AssetsViewCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return runCliRuntimeAction({
    command: 'assets-view',
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const actionRequiredOnly = options.actionRequired || options.needsReview;
        const completion = yield* toCliResult(
          await withAssetsCommandScope(ctx, async (scope) => {
            const result = await runAssetsView(scope, { actionRequiredOnly });
            if (result.isErr()) {
              return err(result.error);
            }

            if (format === 'json') {
              return ok(buildAssetsViewJsonCompletion(actionRequiredOnly, result.value));
            }

            return buildAssetsViewTuiCompletion(actionRequiredOnly, scope, result.value);
          }),
          ExitCodes.GENERAL_ERROR
        );

        return completion;
      }),
  });
}

function buildAssetsViewJsonCompletion(
  actionRequiredOnly: boolean | undefined,
  result: {
    actionRequiredCount: number;
    assets: AssetViewItem[];
    excludedCount: number;
    totalCount: number;
  }
): CliCompletion {
  const payload: ViewAssetsCommandResult = {
    data: result.assets,
    meta: buildViewMeta(result.assets.length, 0, result.assets.length, result.totalCount, {
      ...(actionRequiredOnly ? { actionRequired: true } : {}),
    }),
  };

  return jsonSuccess(payload);
}

async function buildAssetsViewTuiCompletion(
  actionRequiredOnly: boolean | undefined,
  scope: AssetsCommandScope,
  result: {
    actionRequiredCount: number;
    assets: AssetViewItem[];
    excludedCount: number;
    totalCount: number;
  }
): Promise<Result<CliCompletion, Error>> {
  const initialState = createAssetsViewState(
    result.assets,
    {
      totalCount: result.totalCount,
      excludedCount: result.excludedCount,
      actionRequiredCount: result.actionRequiredCount,
    },
    actionRequiredOnly ? 'action-required' : 'default'
  );

  try {
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
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  return ok(silentSuccess());
}
