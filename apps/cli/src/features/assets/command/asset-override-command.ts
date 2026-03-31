import { resultDoAsync, type Result } from '@exitbook/foundation';
import type { ZodType } from 'zod';

import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import { toCliResult, type CliCommandResult, type CliCompletion } from '../../shared/cli-contract.js';
import { detectCliOutputFormat, type CliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliCommandOptionsResult } from '../../shared/command-options.js';
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

  await runCliCommandBoundary({
    command: commandName,
    format,
    action: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, schema);
        return yield* await executeAssetOverrideCommandResult(
          commandName,
          options,
          format,
          runOperation,
          buildCompletion
        );
      }),
  });
}

async function executeAssetOverrideCommandResult<TOptions extends AssetOverrideCommandOptions, TResult>(
  commandName: string,
  options: TOptions,
  format: CliOutputFormat,
  runOperation: (scope: AssetsCommandScope, options: TOptions) => Promise<Result<TResult, Error>>,
  buildCompletion: (format: CliOutputFormat, result: TResult) => CliCompletion
): Promise<CliCommandResult> {
  return captureCliRuntimeResult({
    command: commandName,
    action: async (ctx) =>
      resultDoAsync(async function* () {
        const result = yield* toCliResult(
          await withAssetsCommandScope(ctx, (scope) => runOperation(scope, options)),
          ExitCodes.GENERAL_ERROR
        );

        return buildCompletion(format, result);
      }),
  });
}
