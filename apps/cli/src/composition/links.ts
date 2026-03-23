import { err, ok, type Result } from '@exitbook/core';

import type { LinksRunHandler } from '../features/links/command/links-run-handler.js';
import { createLinksRunHandler } from '../features/links/command/links-run-handler.js';
import type { CommandContext } from '../features/shared/command-runtime.js';
import { ensureConsumerInputsReady } from '../features/shared/projection-runtime.js';

import type { CliAppRuntime } from './runtime.js';

export async function composeLinksRunHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { isJsonMode: boolean }
): Promise<Result<LinksRunHandler, Error>> {
  const database = await ctx.database();
  const readyResult = await ensureConsumerInputsReady('links-run', {
    db: database,
    registry: app.adapterRegistry,
    dataDir: ctx.dataDir,
    isJsonMode: options.isJsonMode,
    blockchainExplorersConfig: app.blockchainExplorersConfig,
    priceProviderConfig: app.priceProviderConfig,
  });
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  return ok(createLinksRunHandler(ctx, database, { isJsonMode: options.isJsonMode }));
}
