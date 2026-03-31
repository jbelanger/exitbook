import { resultDoAsync } from '@exitbook/foundation';

import { toCliResult, type CliCommandResult } from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
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
    return yield* toCliResult(
      await withClearCommandScope(runtime, async (scope) =>
        resultDoAsync(async function* () {
          const params = buildClearParams(scope, options);
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
      ),
      ExitCodes.GENERAL_ERROR
    );
  });
}
