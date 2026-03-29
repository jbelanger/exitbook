import type { Result } from '@exitbook/foundation';
import type { ZodType } from 'zod';

import { runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import type { AssetsCommandScope } from './assets-command-scope.js';
import { withAssetsCommandScope } from './assets-command-scope.js';

interface AssetOverrideCommandOptions {
  assetId?: string | undefined;
  json?: boolean | undefined;
  reason?: string | undefined;
  symbol?: string | undefined;
}

export async function executeAssetOverrideCommand<TOptions extends AssetOverrideCommandOptions, TResult>(
  commandName: string,
  rawOptions: unknown,
  schema: ZodType<TOptions>,
  runOperation: (scope: AssetsCommandScope, options: TOptions) => Promise<Result<TResult, Error>>,
  handleSuccess: (isJsonMode: boolean, result: TResult) => void
): Promise<void> {
  const { format, options } = parseCliCommandOptions(commandName, rawOptions, schema);

  try {
    await runCommand(async (ctx) => {
      const result = await withAssetsCommandScope(ctx, (scope) => runOperation(scope, options));
      if (result.isErr()) {
        displayCliError(commandName, result.error, ExitCodes.GENERAL_ERROR, format);
        return;
      }

      handleSuccess(format === 'json', result.value);
    });
  } catch (error) {
    displayCliError(
      commandName,
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      format
    );
  }
}
