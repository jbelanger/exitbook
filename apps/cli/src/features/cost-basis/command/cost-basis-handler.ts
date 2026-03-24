import {
  CostBasisArtifactService,
  CostBasisWorkflow,
  persistCostBasisFailureSnapshot,
  type CostBasisContext,
  type AccountingExclusionPolicy,
  type ValidatedCostBasisConfig,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting';
import type { AssetReviewSummary } from '@exitbook/core';
import {
  buildCostBasisArtifactStore,
  buildCostBasisFailureSnapshotStore,
  buildCostBasisPorts,
  type DataContext,
} from '@exitbook/data';
import { err, ok, type Result } from '@exitbook/foundation';
import type { PriceProviderConfig } from '@exitbook/price-providers';

import type { CommandScope } from '../../../runtime/command-scope.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { openCliPriceProviderRuntime } from '../../shared/cli-price-provider-runtime.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';
import { readCostBasisDependencyWatermark } from '../../shared/cost-basis-dependency-watermark-runtime.js';

export type { ValidatedCostBasisConfig, CostBasisWorkflowResult };

interface CostBasisArtifactExecutionResult {
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
    private readonly accountingExclusionPolicy: AccountingExclusionPolicy = { excludedAssetIds: new Set<string>() },
    private readonly priceProviderConfig?: PriceProviderConfig | undefined
  ) {}

  async execute(
    params: ValidatedCostBasisConfig,
    options?: { refresh?: boolean | undefined }
  ): Promise<Result<CostBasisWorkflowResult, Error>> {
    const artifactResult = await this.executePreparedArtifact(params, options);
    if (artifactResult.isErr()) {
      return err(artifactResult.error);
    }

    return ok(artifactResult.value.artifact);
  }

  async executeArtifactWithContext(
    params: ValidatedCostBasisConfig,
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
    params: ValidatedCostBasisConfig,
    options?: { refresh?: boolean | undefined }
  ): Promise<Result<PreparedCostBasisArtifactResult, Error>> {
    const contextReader = buildCostBasisPorts(this.db);
    const artifactStore = buildCostBasisArtifactStore(this.db);
    const failureSnapshotStore = buildCostBasisFailureSnapshotStore(this.db);
    const priceRuntimeResult = await openCliPriceProviderRuntime({
      dataDir: this.dataDir,
      providers: this.priceProviderConfig,
    });
    if (priceRuntimeResult.isErr()) {
      return err(new Error(`Failed to create price provider runtime: ${priceRuntimeResult.error.message}`));
    }

    const priceRuntime = priceRuntimeResult.value;
    const executionResult = await (async (): Promise<Result<PreparedCostBasisArtifactResult, Error>> => {
      try {
        const workflow = new CostBasisWorkflow(contextReader, priceRuntime);
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
          config: params,
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
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    const cleanupResult = await priceRuntime.cleanup();
    if (cleanupResult.isErr()) {
      if (executionResult.isErr()) {
        return err(
          new AggregateError(
            [executionResult.error, cleanupResult.error],
            'Cost basis execution failed and price provider runtime cleanup also failed'
          )
        );
      }

      return err(cleanupResult.error);
    }

    return executionResult;
  }
}

/**
 * Create a CostBasisHandler with prereqs (reprocess + linking + price enrichment) run first.
 * Factory runs prereqs via ensureConsumerInputsReady -- command files NEVER call prereqs directly.
 */
export async function createCostBasisHandler(
  ctx: CommandScope,
  options: {
    isJsonMode: boolean;
    params: ValidatedCostBasisConfig;
  }
): Promise<Result<CostBasisHandler, Error>> {
  const database = await ctx.database();
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

  const { params } = options;
  const priceConfig =
    params.startDate && params.endDate ? { startDate: params.startDate, endDate: params.endDate } : undefined;

  const readyResult = await ensureConsumerInputsReady(ctx, 'cost-basis', {
    isJsonMode: options.isJsonMode,
    priceConfig,
    accountingExclusionPolicy: accountingExclusionPolicyResult.value,
    setAbort: (abort) => {
      prereqAbort = abort;
    },
  });
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  prereqAbort = undefined;
  return ok(
    new CostBasisHandler(
      database,
      ctx.dataDir,
      accountingExclusionPolicyResult.value,
      ctx.requireAppRuntime().priceProviderConfig
    )
  );
}
