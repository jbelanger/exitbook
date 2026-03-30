import { type LinkingRunParams, type LinkingRunResult } from '@exitbook/accounting/linking';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { ensureConsumerInputsReady } from '../../../../runtime/consumer-input-readiness.js';
import { executeCliLinkingRuntime, withCliLinkingRuntime } from '../../../../runtime/linking-runtime.js';
import type { CliOutputFormat } from '../../../shared/cli-output-format.js';

export async function runLinks(
  ctx: CommandRuntime,
  options: { format: CliOutputFormat; profileId: number; profileKey: string },
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  try {
    const database = await ctx.database();
    const readyResult = await ensureConsumerInputsReady(ctx, 'links-run', {
      format: options.format,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    return withCliLinkingRuntime(
      {
        dataDir: ctx.dataDir,
        database,
        format: options.format,
        onAbortRegistered: (abort) => ctx.onAbort(abort),
        profileId: options.profileId,
        profileKey: options.profileKey,
      },
      (runtime) => executeCliLinkingRuntime(runtime, params)
    );
  } catch (error) {
    return wrapError(error, 'Failed to run links operation');
  }
}
