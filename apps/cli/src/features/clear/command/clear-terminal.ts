import { resultDoAsync } from '@exitbook/foundation';

import { runCliRuntimeAction } from '../../shared/cli-boundary.js';
import { toCliResult, type CliCommandResult } from '../../shared/cli-contract.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';

import { withClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import { buildClearEmptyCompletion, buildClearSuccessCompletion } from './clear-output.js';
import { calculateTotalDeletionItems, flattenPreview } from './clear-service.js';
import { buildClearParams, previewClear, runClear } from './run-clear.js';

export async function runClearTerminalFlow(options: ClearCommandOptions): Promise<CliCommandResult> {
  const isJsonMode = options.json === true;

  return runCliRuntimeAction({
    command: 'clear',
    unexpectedErrorExitCode: ExitCodes.GENERAL_ERROR,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        return yield* toCliResult(
          await withClearCommandScope(ctx, async (scope) =>
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
      }),
  });
}
