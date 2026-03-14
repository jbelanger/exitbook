import path from 'node:path';

import {
  buildAccountingExclusionFingerprint,
  CostBasisArtifactService,
  CostBasisWorkflow,
  StandardFxRateProvider,
  type AccountingExclusionPolicy,
  type CostBasisInput,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import {
  buildCostBasisArtifactFreshnessPorts,
  buildCostBasisArtifactStore,
  buildCostBasisPorts,
  type DataContext,
} from '@exitbook/data';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { createDefaultPriceProviderManager, readLatestPriceMutationAt } from '@exitbook/price-providers';

import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-runtime.js';
import type { CommandContext, CommandDatabase } from '../../shared/command-runtime.js';
import { ensureConsumerInputsReady } from '../../shared/projection-runtime.js';

export type { CostBasisInput, CostBasisWorkflowResult };

/**
 * Cost Basis Handler - Thin CLI wrapper that runs prereqs then delegates to CostBasisWorkflow.
 */
export class CostBasisHandler {
  constructor(
    private readonly db: DataContext,
    private readonly dataDir: string,
    private readonly accountingExclusionPolicy: AccountingExclusionPolicy = { excludedAssetIds: new Set<string>() }
  ) {}

  async execute(
    params: CostBasisInput,
    options?: { refresh?: boolean | undefined }
  ): Promise<Result<CostBasisWorkflowResult, Error>> {
    const contextReader = buildCostBasisPorts(this.db);
    const artifactStore = buildCostBasisArtifactStore(this.db);
    const latestPriceMutationResult = await readLatestPriceMutationAt(path.join(this.dataDir, 'prices.db'));
    if (latestPriceMutationResult.isErr()) {
      return err(latestPriceMutationResult.error);
    }
    const artifactFreshness = buildCostBasisArtifactFreshnessPorts(this.db, {
      pricesLastMutatedAt: latestPriceMutationResult.value,
    });
    const priceManagerResult = await createDefaultPriceProviderManager({
      dataDir: this.dataDir,
    });
    if (priceManagerResult.isErr()) {
      return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
    }

    const priceManager = priceManagerResult.value;
    try {
      const fxRateProvider = new StandardFxRateProvider(priceManager);
      const workflow = new CostBasisWorkflow(contextReader, fxRateProvider);
      const artifactService = new CostBasisArtifactService(contextReader, artifactStore, workflow);

      const assetReviewSummariesResult = await readAssetReviewProjectionSummaries(this.db);
      if (assetReviewSummariesResult.isErr()) {
        return err(assetReviewSummariesResult.error);
      }

      const exclusionFingerprint = buildAccountingExclusionFingerprint(this.accountingExclusionPolicy.excludedAssetIds);
      const watermarkResult = await artifactFreshness.readCurrentWatermark(exclusionFingerprint);
      if (watermarkResult.isErr()) {
        return err(watermarkResult.error);
      }

      const result = await artifactService.execute({
        params,
        dependencyWatermark: watermarkResult.value,
        refresh: options?.refresh,
        accountingExclusionPolicy: this.accountingExclusionPolicy,
        assetReviewSummaries: assetReviewSummariesResult.value,
      });
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value.artifact);
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

  const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir);
  if (accountingExclusionPolicyResult.isErr()) {
    return err(accountingExclusionPolicyResult.error);
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
    priceConfig,
    accountingExclusionPolicyResult.value
  );
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  prereqAbort = undefined;
  return ok(new CostBasisHandler(database, ctx.dataDir, accountingExclusionPolicyResult.value));
}
