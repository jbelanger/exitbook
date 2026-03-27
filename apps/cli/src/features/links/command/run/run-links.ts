import { type LinkingRunParams, type LinkingRunResult } from '@exitbook/accounting/linking';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { ensureConsumerInputsReady } from '../../../../runtime/consumer-input-readiness.js';
import {
  abortCliLinkingRuntime,
  createCliLinkingRuntime,
  executeCliLinkingRuntime,
  type CliLinkingRuntime,
} from '../../../../runtime/linking-runtime.js';

export async function runLinks(
  ctx: CommandRuntime,
  options: { isJsonMode: boolean; profileId: number; profileKey: string },
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  try {
    const database = await ctx.database();
    const readyResult = await ensureConsumerInputsReady(ctx, 'links-run', {
      isJsonMode: options.isJsonMode,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    const runtimeResult = createCliLinkingRuntime({
      dataDir: ctx.dataDir,
      database,
      isJsonMode: options.isJsonMode,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (runtimeResult.isErr()) {
      return err(runtimeResult.error);
    }

    const runtime: CliLinkingRuntime = runtimeResult.value;
    ctx.onAbort(() => abortCliLinkingRuntime(runtime));
    return executeCliLinkingRuntime(runtime, options.profileKey, params);
  } catch (error) {
    return wrapError(error, 'Failed to run links operation');
  }
}
