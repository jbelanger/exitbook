import { runCommand } from '../../../runtime/command-scope.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { handleCancellation, promptConfirm } from '../../shared/prompts.js';
import { createSpinner, stopSpinner } from '../../shared/spinner.js';

import type { ClearCommandOptions } from './clear-command-types.js';
import { calculateTotalDeletionItems, createClearHandler, flattenPreview } from './clear-handler.js';
import { handleClearSuccess, outputClearEmptyResult, outputClearPreview } from './clear-output.js';

export async function runClearTerminalFlow(options: ClearCommandOptions): Promise<void> {
  const includeRaw = options.includeRaw ?? false;
  const outputMode = options.json ? 'json' : 'text';

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const clearHandler = createClearHandler({ db: database });

      const previewResult = await clearHandler.preview({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      if (previewResult.isErr()) {
        displayCliError('clear', previewResult.error, ExitCodes.GENERAL_ERROR, outputMode);
      }

      const flat = flattenPreview(previewResult.value);
      if (calculateTotalDeletionItems(flat) === 0) {
        outputClearEmptyResult(flat, options.json ?? false);
        return;
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
      const result = await clearHandler.execute({
        accountId: options.accountId,
        source: options.source,
        includeRaw,
      });

      if (result.isErr()) {
        stopSpinner(spinner);
        displayCliError('clear', result.error, ExitCodes.GENERAL_ERROR, outputMode);
      }

      handleClearSuccess(result.value, spinner, options.json ?? false);
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
