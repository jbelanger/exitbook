import type { Result } from '@exitbook/core';

import type { ImportHandler } from '../features/import/command/import-handler.js';
import { createImportHandler } from '../features/import/command/import-handler.js';
import type { ReprocessHandler } from '../features/reprocess/command/reprocess-handler.js';
import { createReprocessHandler } from '../features/reprocess/command/reprocess-handler.js';
import type { CommandContext } from '../features/shared/command-runtime.js';

import type { CliAppRuntime } from './runtime.js';

export async function composeImportHandler(
  app: CliAppRuntime,
  ctx: CommandContext
): Promise<Result<ImportHandler, Error>> {
  const database = await ctx.database();
  return createImportHandler(ctx, database, app.adapterRegistry, {
    explorerConfig: app.blockchainExplorersConfig,
  });
}

export async function composeReprocessHandler(
  app: CliAppRuntime,
  ctx: CommandContext
): Promise<Result<ReprocessHandler, Error>> {
  const database = await ctx.database();
  return createReprocessHandler(ctx, database, app.adapterRegistry, {
    explorerConfig: app.blockchainExplorersConfig,
  });
}
