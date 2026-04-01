import { resultDoAsync } from '@exitbook/foundation';
import React from 'react';

import { cliErr, silentSuccess, type CliCommandResult } from '../../../cli/command.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { renderApp } from '../../../runtime/command-runtime.js';
import {
  formatAccountSelectorLabel,
  getAccountSelectorErrorExitCode,
  resolveOwnedAccountSelector,
} from '../../accounts/account-selector.js';
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
    const completion = await withClearCommandScope(runtime, async (scope) =>
      resultDoAsync(async function* () {
        const selection = yield* await resolveOwnedAccountSelector(scope.accountService, scope.profile.id, options);
        const params = buildClearParams(scope, options, selection?.account.id);

        const [previewWithoutRawResult, previewWithRawResult] = await Promise.all([
          previewClear(scope, { ...params, includeRaw: false }),
          previewClear(scope, { ...params, includeRaw: true }),
        ]);

        const previewWithoutRaw = flattenPreview(yield* previewWithoutRawResult);
        const previewWithRaw = flattenPreview(yield* previewWithRawResult);
        const scopeLabel = buildScopeLabel(
          selection ? formatAccountSelectorLabel(selection.account) : undefined,
          options.platform
        );

        const initialState = createClearViewState(
          { accountId: selection?.account.id, platformKey: options.platform, label: scopeLabel },
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
    );

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}
