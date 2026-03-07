import path from 'node:path';

import {
  CostBasisWorkflow,
  StandardFxRateProvider,
  type CostBasisInput,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import { buildCostBasisPorts, type DataContext } from '@exitbook/data';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { createPriceProviderManager } from '@exitbook/price-providers';

import type { CommandContext, CommandDatabase } from '../shared/command-runtime.js';
import { getDataDir } from '../shared/data-dir.js';
import { ensureLinks, ensurePrices, ensureRawDataIsProcessed } from '../shared/prereqs.js';

export type { CostBasisInput, CostBasisWorkflowResult };

/**
 * Cost Basis Handler - Thin CLI wrapper that runs prereqs then delegates to CostBasisWorkflow.
 */
export class CostBasisHandler {
  constructor(private readonly db: DataContext) {}

  async execute(params: CostBasisInput): Promise<Result<CostBasisWorkflowResult, Error>> {
    const store = buildCostBasisPorts(this.db);
    const dataDir = getDataDir();
    const priceManagerResult = await createPriceProviderManager({
      providers: { databasePath: path.join(dataDir, 'prices.db') },
    });
    if (priceManagerResult.isErr()) {
      return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
    }

    const priceManager = priceManagerResult.value;
    try {
      const fxRateProvider = new StandardFxRateProvider(priceManager);
      const workflow = new CostBasisWorkflow(store, fxRateProvider);

      const txResult = await this.db.transactions.findAll();
      if (txResult.isErr()) return err(txResult.error);

      return await workflow.execute(params, txResult.value);
    } finally {
      await priceManager.destroy();
    }
  }
}

/**
 * Create a CostBasisHandler with prereqs (reprocess + linking + price enrichment) run first.
 * Factory runs prereqs -- command files NEVER call ensureRawDataIsProcessed/ensureLinks/ensurePrices directly.
 */
export async function createCostBasisHandler(
  ctx: CommandContext,
  database: CommandDatabase,
  options: { isJsonMode: boolean; params: CostBasisInput; registry: AdapterRegistry }
): Promise<Result<CostBasisHandler, Error>> {
  let prereqAbort: (() => void) | undefined;
  if (!options.isJsonMode) {
    ctx.onAbort(() => {
      prereqAbort?.();
    });
  }

  // Reprocess derived data if stale
  const processedResult = await ensureRawDataIsProcessed(database, options.registry, {
    isJsonMode: options.isJsonMode,
  });
  if (processedResult.isErr()) {
    return err(processedResult.error);
  }

  // Run linking prereq
  const linksResult = await ensureLinks(database, ctx.dataDir, {
    isJsonMode: options.isJsonMode,
    setAbort: (abort) => {
      prereqAbort = abort;
    },
  });
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  // Run price enrichment prereq (needs date range from params)
  const { config } = options.params;
  if (config.startDate && config.endDate) {
    const pricesResult = await ensurePrices(database, config.startDate, config.endDate, config.currency, {
      isJsonMode: options.isJsonMode,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    });
    if (pricesResult.isErr()) {
      return err(pricesResult.error);
    }
  }

  prereqAbort = undefined;
  return ok(new CostBasisHandler(database));
}
