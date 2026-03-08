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

import type { CommandContext, CommandDatabase } from '../../shared/command-runtime.js';
import { getDataDir } from '../../shared/data-dir.js';
import { ensureConsumerInputsReady } from '../../shared/projection-runtime.js';

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
 * Factory runs prereqs via ensureConsumerInputsReady -- command files NEVER call prereqs directly.
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

  const { config } = options.params;
  const priceConfig =
    config.startDate && config.endDate ? { startDate: config.startDate, endDate: config.endDate } : undefined;

  const readyResult = await ensureConsumerInputsReady(
    'cost-basis',
    {
      db: database,
      registry: options.registry,
      dataDir: ctx.dataDir,
      isJsonMode: options.isJsonMode,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    },
    priceConfig
  );
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  prereqAbort = undefined;
  return ok(new CostBasisHandler(database));
}
