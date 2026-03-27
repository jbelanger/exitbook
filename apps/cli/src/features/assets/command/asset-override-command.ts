import { OverrideStore } from '@exitbook/data/overrides';
import type { Result } from '@exitbook/foundation';
import type { ZodType } from 'zod';

import { runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';

import { AssetsHandler } from './assets-handler.js';

interface AssetOverrideCommandOptions {
  assetId?: string | undefined;
  json?: boolean | undefined;
  reason?: string | undefined;
  symbol?: string | undefined;
}

interface AssetOverrideCommandContext<TOptions extends AssetOverrideCommandOptions> {
  options: TOptions;
  profileId: number;
  profileKey: string;
}

export async function executeAssetOverrideCommand<TOptions extends AssetOverrideCommandOptions, TResult>(
  commandName: string,
  rawOptions: unknown,
  schema: ZodType<TOptions>,
  runOperation: (
    handler: AssetsHandler,
    context: AssetOverrideCommandContext<TOptions>
  ) => Promise<Result<TResult, Error>>,
  handleSuccess: (isJsonMode: boolean, result: TResult) => void
): Promise<void> {
  const { format, options } = parseCliCommandOptions(commandName, rawOptions, schema);

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError(commandName, profileResult.error, ExitCodes.GENERAL_ERROR, format);
        return;
      }

      const handler = new AssetsHandler(database, new OverrideStore(ctx.dataDir), ctx.dataDir);
      const result = await runOperation(handler, {
        options,
        profileId: profileResult.value.id,
        profileKey: profileResult.value.profileKey,
      });
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
