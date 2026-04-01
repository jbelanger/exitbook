import { resultDoAsync } from '@exitbook/foundation';

import { cliErr, type CliCommandResult } from '../../../cli/command.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { getAccountSelectorErrorExitCode, resolveOwnedAccountSelector } from '../../accounts/account-selector.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';

import { withClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import { buildClearEmptyCompletion, buildClearSuccessCompletion } from './clear-output.js';
import { calculateTotalDeletionItems, flattenPreview } from './clear-service.js';
import { buildClearParams, previewClear, runClear } from './run-clear.js';

export async function runClearTerminalFlow(
  runtime: CommandRuntime,
  options: ClearCommandOptions
): Promise<CliCommandResult> {
  const isJsonMode = options.json === true;

  return resultDoAsync(async function* () {
    const completion = await withClearCommandScope(runtime, async (scope) =>
      resultDoAsync(async function* () {
        const selection = yield* await resolveOwnedAccountSelector(scope.accountService, scope.profile.id, options);
        const params = buildClearParams(scope, options, selection?.account.id);
        const preview = yield* await previewClear(scope, params);
        const flat = flattenPreview(preview);
        if (calculateTotalDeletionItems(flat) === 0) {
          return buildClearEmptyCompletion(flat, isJsonMode);
        }

        const spinner = createSpinner('Clearing data...', isJsonMode);
        const result = await runClear(scope, params);
        if (result.isErr()) {
          stopSpinner(spinner);
          return yield* result;
        }

        return buildClearSuccessCompletion(result.value, spinner, isJsonMode);
      })
    );

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}
