import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildViewMeta, type ViewCommandResult } from '../../shared/view-utils.js';
import { AssetsViewApp } from '../view/assets-view-components.jsx';
import { createAssetsViewState } from '../view/assets-view-state.js';

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
    .action(async (rawOptions: unknown) => {
      await executeAssetsViewCommand(rawOptions);
    });
}

async function executeAssetsViewCommand(rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('assets-view', rawOptions, AssetsViewCommandOptionsSchema);

  if (format === 'json') {
    await executeAssetsViewJson(options);
    return;
  }

  await executeAssetsViewTui(options);
}

async function executeAssetsViewJson(options: AssetsViewCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const actionRequiredOnly = options.actionRequired || options.needsReview;
      const commandResult = await withAssetsCommandScope(ctx, async (scope) => {
        const result = await runAssetsView(scope, { actionRequiredOnly });
        if (result.isErr()) {
          return result;
        }

        const payload: ViewAssetsCommandResult = {
          data: result.value.assets,
          meta: buildViewMeta(result.value.assets.length, 0, result.value.assets.length, result.value.totalCount, {
            ...(actionRequiredOnly ? { actionRequired: true } : {}),
          }),
        };

        outputSuccess('assets-view', payload);
        return result;
      });

      if (commandResult.isErr()) {
        displayCliError('assets-view', commandResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }
    });
  } catch (error) {
    displayCliError(
      'assets-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

async function executeAssetsViewTui(options: AssetsViewCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const actionRequiredOnly = options.actionRequired || options.needsReview;
      const commandResult = await withAssetsCommandScope(ctx, async (scope) => {
        const result = await runAssetsView(scope, { actionRequiredOnly });

        if (result.isErr()) {
          return result;
        }

        const initialState = createAssetsViewState(
          result.value.assets,
          {
            totalCount: result.value.totalCount,
            excludedCount: result.value.excludedCount,
            actionRequiredCount: result.value.actionRequiredCount,
          },
          actionRequiredOnly ? 'action-required' : 'default'
        );

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

        return result;
      });

      if (commandResult.isErr()) {
        displayCliError('assets-view', commandResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }
    });
  } catch (error) {
    displayCliError(
      'assets-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
