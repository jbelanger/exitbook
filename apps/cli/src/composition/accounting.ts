import type { Result } from '@exitbook/core';

import type { CostBasisHandler, ValidatedCostBasisConfig } from '../features/cost-basis/command/cost-basis-handler.js';
import { createCostBasisHandler } from '../features/cost-basis/command/cost-basis-handler.js';
import type { PortfolioHandler } from '../features/portfolio/command/portfolio-handler.js';
import { createPortfolioHandler } from '../features/portfolio/command/portfolio-handler.js';
import type { PricesEnrichHandler } from '../features/prices/command/prices-enrich-handler.js';
import { createPricesEnrichHandler } from '../features/prices/command/prices-enrich-handler.js';
import type { CommandContext } from '../features/shared/command-runtime.js';

import type { CliAppRuntime } from './runtime.js';

export async function composeCostBasisHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { isJsonMode: boolean; params: ValidatedCostBasisConfig }
): Promise<Result<CostBasisHandler, Error>> {
  const database = await ctx.database();
  return createCostBasisHandler(ctx, database, {
    ...options,
    registry: app.adapterRegistry,
    blockchainExplorersConfig: app.blockchainExplorersConfig,
    priceProviderConfig: app.priceProviderConfig,
  });
}

export async function composePortfolioHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { asOf: Date; isJsonMode: boolean }
): Promise<Result<PortfolioHandler, Error>> {
  const database = await ctx.database();
  return createPortfolioHandler(ctx, database, {
    ...options,
    registry: app.adapterRegistry,
    blockchainExplorersConfig: app.blockchainExplorersConfig,
    priceProviderConfig: app.priceProviderConfig,
  });
}

export async function composePricesEnrichHandler(
  app: CliAppRuntime,
  ctx: CommandContext,
  options: { isJsonMode: boolean }
): Promise<Result<PricesEnrichHandler, Error>> {
  const database = await ctx.database();
  return createPricesEnrichHandler(ctx, database, {
    ...options,
    priceProviderConfig: app.priceProviderConfig,
  });
}
