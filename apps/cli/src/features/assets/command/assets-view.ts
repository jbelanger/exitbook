import { OverrideStore } from '@exitbook/data';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../../shared/cli-error.js';
import { renderApp, runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { AssetsViewCommandOptionsSchema } from '../../shared/schemas.js';
import { buildViewMeta, type ViewCommandResult } from '../../shared/view-utils.js';
import { AssetsViewApp } from '../view/assets-view-components.jsx';
import { createAssetsViewState } from '../view/assets-view-state.js';

import { AssetsHandler, type AssetViewItem } from './assets-handler.js';

export type AssetsViewCommandOptions = z.infer<typeof AssetsViewCommandOptionsSchema>;

type ViewAssetsCommandResult = ViewCommandResult<AssetViewItem[]>;

export function registerAssetsViewCommand(assetsCommand: Command): void {
  assetsCommand
    .command('view')
    .description('View assets, review state, and accounting exclusion state')
    .option('--needs-review', 'Show only assets that still require review')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeAssetsViewCommand(rawOptions);
    });
}

async function executeAssetsViewCommand(rawOptions: unknown): Promise<void> {
  const parseResult = AssetsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'assets-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;

  if (options.json) {
    await executeAssetsViewJson(options);
    return;
  }

  await executeAssetsViewTui(options);
}

async function executeAssetsViewJson(options: AssetsViewCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const result = await handler.view({ needsReview: options.needsReview });

      if (result.isErr()) {
        displayCliError('assets-view', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const payload: ViewAssetsCommandResult = {
        data: result.value.assets,
        meta: buildViewMeta(
          result.value.assets.length,
          0,
          result.value.assets.length,
          result.value.totalCount,
          options.needsReview ? { needsReview: true } : undefined
        ),
      };

      outputSuccess('assets-view', payload);
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
      const database = await ctx.database();
      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const result = await handler.view({ needsReview: options.needsReview });

      if (result.isErr()) {
        displayCliError('assets-view', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const initialState = createAssetsViewState(
        result.value.assets,
        {
          totalCount: result.value.totalCount,
          excludedCount: result.value.excludedCount,
          needsReviewCount: result.value.needsReviewCount,
        },
        options.needsReview ? 'needs-review' : 'all'
      );

      await renderApp((unmount) =>
        React.createElement(AssetsViewApp, {
          initialState,
          onQuit: unmount,
          onToggleExclusion: async (assetId, excluded) => {
            const actionResult = excluded ? await handler.include({ assetId }) : await handler.exclude({ assetId });
            if (actionResult.isErr()) {
              throw actionResult.error;
            }
            return actionResult.value;
          },
          onConfirmReview: async (assetId) => {
            const actionResult = await handler.confirmReview({ assetId });
            if (actionResult.isErr()) {
              throw actionResult.error;
            }
            return actionResult.value;
          },
          onClearReview: async (assetId) => {
            const actionResult = await handler.clearReview({ assetId });
            if (actionResult.isErr()) {
              throw actionResult.error;
            }
            return actionResult.value;
          },
        })
      );
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
