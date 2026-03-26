import { OverrideStore } from '@exitbook/data/overrides';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { buildViewMeta, type ViewCommandResult } from '../../shared/view-utils.js';
import { AssetsViewApp } from '../view/assets-view-components.jsx';
import { createAssetsViewState } from '../view/assets-view-state.js';

import { AssetsHandler, type AssetViewItem } from './assets-handler.js';
import { AssetsViewCommandOptionsSchema } from './assets-option-schemas.js';

type AssetsViewCommandOptions = z.infer<typeof AssetsViewCommandOptionsSchema>;

type ViewAssetsCommandResult = ViewCommandResult<AssetViewItem[]>;

export function registerAssetsViewCommand(assetsCommand: Command): void {
  assetsCommand
    .command('view')
    .description('View assets and review flagged ones')
    .option('--profile <profile>', 'Use a specific profile key instead of the active profile')
    .option('--action-required', 'Show only flagged assets that still need attention')
    .option('--needs-review', 'Alias for --action-required')
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
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        displayCliError('assets-view', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const actionRequiredOnly = options.actionRequired || options.needsReview;
      const result = await handler.view({ actionRequiredOnly, profileId: profileResult.value.id });

      if (result.isErr()) {
        displayCliError('assets-view', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const payload: ViewAssetsCommandResult = {
        data: result.value.assets,
        meta: buildViewMeta(result.value.assets.length, 0, result.value.assets.length, result.value.totalCount, {
          ...(actionRequiredOnly ? { actionRequired: true } : {}),
          ...(options.profile ? { profile: options.profile } : {}),
        }),
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
      const profileResult = await resolveCommandProfile(ctx, database, options.profile);
      if (profileResult.isErr()) {
        displayCliError('assets-view', profileResult.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const overrideStore = new OverrideStore(ctx.dataDir);
      const handler = new AssetsHandler(database, overrideStore, ctx.dataDir);
      const actionRequiredOnly = options.actionRequired || options.needsReview;
      const result = await handler.view({ actionRequiredOnly, profileId: profileResult.value.id });

      if (result.isErr()) {
        displayCliError('assets-view', result.error, ExitCodes.GENERAL_ERROR, 'text');
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
              ? await handler.include({ assetId, profileId: profileResult.value.id })
              : await handler.exclude({ assetId, profileId: profileResult.value.id });
            if (actionResult.isErr()) {
              throw actionResult.error;
            }
            return actionResult.value;
          },
          onConfirmReview: async (assetId) => {
            const actionResult = await handler.confirmReview({ assetId, profileId: profileResult.value.id });
            if (actionResult.isErr()) {
              throw actionResult.error;
            }
            return actionResult.value;
          },
          onClearReview: async (assetId) => {
            const actionResult = await handler.clearReview({ assetId, profileId: profileResult.value.id });
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
