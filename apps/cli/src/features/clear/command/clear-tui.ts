import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { ClearViewApp } from '../view/clear-view-components.jsx';
import { createClearViewState } from '../view/clear-view-state.js';

import type { ClearCommandOptions } from './clear-command-types.js';
import { createClearHandler, flattenPreview } from './clear-handler.js';
import { buildScopeLabel } from './clear-output.js';

export async function runClearTuiFlow(options: ClearCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const clearHandler = createClearHandler({ db: database });

      const params = {
        accountId: options.accountId,
        source: options.source,
        includeRaw: options.includeRaw ?? false,
      };

      const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
        clearHandler.preview({ ...params, includeRaw: false }),
        clearHandler.preview({ ...params, includeRaw: true }),
      ]);

      if (previewWithoutRawResult.isErr()) {
        console.error(`\nWARNING: ${previewWithoutRawResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      if (previewWithRawResult.isErr()) {
        console.error(`\nWARNING: ${previewWithRawResult.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const previewWithoutRaw = flattenPreview(previewWithoutRawResult.value);
      const previewWithRaw = flattenPreview(previewWithRawResult.value);
      const scopeLabel = await buildScopeLabel(options.accountId, options.source, database.accounts);

      const initialState = createClearViewState(
        { accountId: options.accountId, source: options.source, label: scopeLabel },
        previewWithRaw,
        previewWithoutRaw,
        options.includeRaw ?? false
      );

      await renderApp((unmount) =>
        React.createElement(ClearViewApp, {
          initialState,
          clearHandler,
          params,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'clear',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
