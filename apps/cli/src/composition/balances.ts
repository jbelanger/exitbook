import type { Result } from '@exitbook/core';

import type { BalanceHandler } from '../features/balance/command/balance-handler.js';
import { createBalanceHandler } from '../features/balance/command/balance-handler.js';
import type { CommandContext } from '../features/shared/command-runtime.js';

import type { CliAppRuntime } from './runtime.js';

async function composeBalanceHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { needsWorkflow: boolean }
): Promise<Result<BalanceHandler, Error>> {
  const database = await ctx.database();
  return createBalanceHandler(ctx, database, {
    ...options,
    explorerConfig: app.blockchainExplorersConfig,
  });
}

export async function composeBalanceViewHandler(
  app: CliAppRuntime,
  ctx: CommandContext
): Promise<Result<BalanceHandler, Error>> {
  return composeBalanceHandler(app, ctx, { needsWorkflow: true });
}

export async function composeBalanceRefreshHandler(
  app: CliAppRuntime,
  ctx: CommandContext
): Promise<Result<BalanceHandler, Error>> {
  return composeBalanceHandler(app, ctx, { needsWorkflow: true });
}
