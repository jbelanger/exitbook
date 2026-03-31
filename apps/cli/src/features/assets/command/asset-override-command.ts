import { resultDoAsync, type Result } from '@exitbook/foundation';
import type { ZodType } from 'zod';

import { runCliRuntimeCommand, toCliResult, type CliCompletion } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult, type CliOutputFormat } from '../../../cli/options.js';
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
  buildCompletion: (format: CliOutputFormat, result: TResult) => CliCompletion
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<TOptions>({
    command: commandName,
    format,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, schema),
    action: async ({ runtime, prepared: options }) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withAssetsCommandScope(runtime, (scope) => runOperation(scope, options)),
          ExitCodes.GENERAL_ERROR
        );

        return buildCompletion(format, result);
      }),
  });
}
