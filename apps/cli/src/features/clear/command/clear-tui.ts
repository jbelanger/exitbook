import { err, ok } from '@exitbook/foundation';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { ClearViewApp } from '../view/clear-view-components.jsx';
import { createClearViewState } from '../view/clear-view-state.js';

import { withClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import { flattenPreview } from './clear-handler.js';
import { buildScopeLabel } from './clear-output.js';
import { buildClearParams, previewClear } from './run-clear.js';

export async function runClearTuiFlow(options: ClearCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const commandResult = await withClearCommandScope(ctx, async (scope) => {
        const params = buildClearParams(scope, options);

        const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
          previewClear(scope, { ...params, includeRaw: false }),
          previewClear(scope, { ...params, includeRaw: true }),
        ]);

        if (previewWithoutRawResult.isErr()) {
          console.error(`\nWARNING: ${previewWithoutRawResult.error.message}`);
          ctx.exitCode = ExitCodes.GENERAL_ERROR;
          return err(previewWithoutRawResult.error);
        }

        if (previewWithRawResult.isErr()) {
          console.error(`\nWARNING: ${previewWithRawResult.error.message}`);
          ctx.exitCode = ExitCodes.GENERAL_ERROR;
          return err(previewWithRawResult.error);
        }

        const previewWithoutRaw = flattenPreview(previewWithoutRawResult.value);
        const previewWithRaw = flattenPreview(previewWithRawResult.value);
        const scopeLabel = buildScopeLabel(options.accountId, options.platform);

        const initialState = createClearViewState(
          { accountId: options.accountId, platformKey: options.platform, label: scopeLabel },
          previewWithRaw,
          previewWithoutRaw,
          options.includeRaw ?? false
        );

        await renderApp((unmount) =>
          React.createElement(ClearViewApp, {
            initialState,
            clearHandler: scope.handler,
            params,
            onQuit: unmount,
          })
        );

        return ok(undefined);
      });

      if (commandResult.isErr()) {
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
      }
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
