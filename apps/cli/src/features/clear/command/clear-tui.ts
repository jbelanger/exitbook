import { resultDoAsync } from '@exitbook/foundation';
import React from 'react';

import { silentSuccess, toCliResult, type CliCommandResult } from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import { ClearViewApp } from '../view/clear-view-components.jsx';
import { createClearViewState } from '../view/clear-view-state.js';

import { withClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import { buildScopeLabel } from './clear-output.js';
import { flattenPreview } from './clear-service.js';
import { buildClearParams, previewClear } from './run-clear.js';

export async function runClearTuiFlow(
  runtime: CommandRuntime,
  options: ClearCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    return yield* toCliResult(
      await withClearCommandScope(runtime, async (scope) =>
        resultDoAsync(async function* () {
          const params = buildClearParams(scope, options);

          const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
            previewClear(scope, { ...params, includeRaw: false }),
            previewClear(scope, { ...params, includeRaw: true }),
          ]);

          const previewWithoutRaw = flattenPreview(yield* previewWithoutRawResult);
          const previewWithRaw = flattenPreview(yield* previewWithRawResult);
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
              clearService: scope.clearService,
              params,
              onQuit: unmount,
            })
          );

          return silentSuccess();
        })
      ),
      ExitCodes.GENERAL_ERROR
    );
  });
}
