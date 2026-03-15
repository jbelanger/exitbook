import {
  CostBasisArtifactService,
  CostBasisWorkflow,
  persistCostBasisFailureSnapshot,
  StandardFxRateProvider,
  type CostBasisContext,
  type AccountingExclusionPolicy,
  type CostBasisInput,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting';
import { err, ok, type AssetReviewSummary, type Result } from '@exitbook/core';
import {
  buildCostBasisArtifactStore,
  buildCostBasisFailureSnapshotStore,
  buildCostBasisPorts,
  type DataContext,
} from '@exitbook/data';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { createDefaultPriceProviderManager } from '@exitbook/price-providers';

import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-runtime.js';
import type { CommandContext, CommandDatabase } from '../../shared/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../shared/cost-basis-dependency-watermark-runtime.js';
import { ensureConsumerInputsReady } from '../../shared/projection-runtime.js';

export type { CostBasisInput, CostBasisWorkflowResult };

export interface CostBasisArtifactExecutionResult {
  artifact: CostBasisWorkflowResult;
  scopeKey: string;
  snapshotId: string;
  sourceContext: CostBasisContext;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
}

interface PreparedCostBasisArtifactResult {
  artifact: CostBasisWorkflowResult;
  scopeKey: string;
  snapshotId: string;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
}

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
    const artifactResult = await this.executePreparedArtifact(params, options);
    if (artifactResult.isErr()) {
      return err(artifactResult.error);
    }

    return ok(artifactResult.value.artifact);
  }

  async executeArtifactWithContext(
    params: CostBasisInput,
    options?: { refresh?: boolean | undefined }
  ): Promise<Result<CostBasisArtifactExecutionResult, Error>> {
    const artifactResult = await this.executePreparedArtifact(params, options);
    if (artifactResult.isErr()) {
      return err(artifactResult.error);
    }

    const sourceContextResult = await buildCostBasisPorts(this.db).loadCostBasisContext();
    if (sourceContextResult.isErr()) {
      return err(sourceContextResult.error);
    }

    return ok({
      artifact: artifactResult.value.artifact,
      scopeKey: artifactResult.value.scopeKey,
      snapshotId: artifactResult.value.snapshotId,
      sourceContext: sourceContextResult.value,
      assetReviewSummaries: artifactResult.value.assetReviewSummaries,
    });
  }

  private async executePreparedArtifact(
    params: CostBasisInput,
    options?: { refresh?: boolean | undefined }
  ): Promise<Result<PreparedCostBasisArtifactResult, Error>> {
    const contextReader = buildCostBasisPorts(this.db);
    const artifactStore = buildCostBasisArtifactStore(this.db);
    const failureSnapshotStore = buildCostBasisFailureSnapshotStore(this.db);
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

      const watermarkResult = await readCostBasisDependencyWatermark(
        this.db,
        this.dataDir,
        this.accountingExclusionPolicy
      );
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
        const failurePersistResult = await persistCostBasisFailureSnapshot(failureSnapshotStore, {
          consumer: 'cost-basis',
          input: params,
          dependencyWatermark: watermarkResult.value,
          error: result.error,
          stage: 'artifact-service.execute',
          context: {
            refresh: options?.refresh === true,
          },
        });
        if (failurePersistResult.isErr()) {
          return err(
            new Error(
              `Cost basis failed: ${result.error.message}. Additionally, failure snapshot persistence failed: ${failurePersistResult.error.message}`,
              { cause: result.error }
            )
          );
        }
        return err(result.error);
      }

      return ok({
        artifact: result.value.artifact,
        scopeKey: result.value.scopeKey,
        snapshotId: result.value.snapshotId,
        assetReviewSummaries: assetReviewSummariesResult.value,
      });
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
