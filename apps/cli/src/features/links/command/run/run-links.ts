import { type LinkingRunParams, type LinkingRunResult } from '@exitbook/accounting/linking';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../../cli/options.js';
import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { ensureConsumerInputsReady } from '../../../../runtime/consumer-input-readiness.js';

import { executeCliLinkingRuntime, withCliLinkingRuntime } from './links-runtime.js';

export async function runLinks(
  ctx: CommandRuntime,
  options: { format: CliOutputFormat; profileId: number; profileKey: string },
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  return resultTryAsync<LinkingRunResult>(async function* () {
    const database = await ctx.openDatabaseSession();
    const readyResult = await ensureConsumerInputsReady(ctx, 'links-run', {
      format: options.format,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (readyResult.isErr()) {
      return yield* err(readyResult.error);
    }

    const result = yield* await withCliLinkingRuntime(
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
    return result;
  }, 'Failed to run links operation');
}
