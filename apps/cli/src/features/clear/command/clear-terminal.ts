import { err, ok } from '@exitbook/foundation';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { handleCancellation, promptConfirm } from '../../shared/prompts.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';

import { withClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import { handleClearSuccess, outputClearEmptyResult, outputClearPreview } from './clear-output.js';
import { calculateTotalDeletionItems, flattenPreview } from './clear-service.js';
import { buildClearParams, previewClear, runClear } from './run-clear.js';

export async function runClearTerminalFlow(options: ClearCommandOptions): Promise<void> {
  const includeRaw = options.includeRaw ?? false;
  const outputMode = options.json ? 'json' : 'text';

  try {
    await runCommand(async (ctx) => {
      const commandResult = await withClearCommandScope(ctx, async (scope) => {
        const params = buildClearParams(scope, options);
        const previewResult = await previewClear(scope, params);
        if (previewResult.isErr()) {
          return err(previewResult.error);
        }

        const flat = flattenPreview(previewResult.value);
        if (calculateTotalDeletionItems(flat) === 0) {
          outputClearEmptyResult(flat, options.json ?? false);
          return ok(undefined);
        }

        if (!options.confirm && !options.json) {
          outputClearPreview(flat, includeRaw);
          const confirmMessage = includeRaw ? 'Delete ALL data including raw imports?' : 'Clear processed data?';
          const shouldProceed = await promptConfirm(confirmMessage, false);
          if (!shouldProceed) {
            handleCancellation('Clear cancelled');
          }
        }

        const spinner = createSpinner('Clearing data...', options.json ?? false);
        const result = await runClear(scope, params);
        if (result.isErr()) {
          stopSpinner(spinner);
          return err(result.error);
        }

        handleClearSuccess(result.value, spinner, options.json ?? false);
        return ok(undefined);
      });

      if (commandResult.isErr()) {
        displayCliError('clear', commandResult.error, ExitCodes.GENERAL_ERROR, outputMode);
      }
    });
  } catch (error) {
    displayCliError(
      'clear',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      outputMode
    );
  }
}
