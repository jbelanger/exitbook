import type { AccountingExclusionPolicy } from '@exitbook/accounting/accounting-model';
import {
  CostBasisArtifactService,
  CostBasisWorkflow,
  persistCostBasisFailureSnapshot,
  type CostBasisContext,
  type CostBasisDependencyWatermark,
  type ValidatedCostBasisConfig,
  type CostBasisWorkflowResult,
} from '@exitbook/accounting/cost-basis';
import type { AssetReviewSummary } from '@exitbook/core';
import {
  buildCostBasisArtifactStore,
  buildCostBasisFailureSnapshotStore,
  buildCostBasisPorts,
} from '@exitbook/data/accounting';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';

export type { ValidatedCostBasisConfig };

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

type ReadCostBasisDependencyWatermark = () => Promise<Result<CostBasisDependencyWatermark, Error>>;

/**
 * Cost Basis Handler - Thin CLI wrapper that runs prereqs then delegates to CostBasisWorkflow.
 */
export class CostBasisHandler {
  constructor(
    private readonly db: DataSession,
    private readonly profileId: number,
    private readonly accountingExclusionPolicy: AccountingExclusionPolicy = { excludedAssetIds: new Set<string>() },
    private readonly priceRuntime: IPriceProviderRuntime,
    private readonly readDependencyWatermark: ReadCostBasisDependencyWatermark
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

    const sourceContextResult = await buildCostBasisPorts(this.db, this.profileId).loadCostBasisContext();
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
    const contextReader = buildCostBasisPorts(this.db, this.profileId);
    const artifactStore = buildCostBasisArtifactStore(this.db);
    const failureSnapshotStore = buildCostBasisFailureSnapshotStore(this.db);
    try {
      const workflow = new CostBasisWorkflow(contextReader, this.priceRuntime);
      const artifactService = new CostBasisArtifactService(contextReader, artifactStore, workflow);

      const assetReviewSummariesResult = await readAssetReviewProjectionSummaries(this.db, this.profileId);
      if (assetReviewSummariesResult.isErr()) {
        return err(assetReviewSummariesResult.error);
      }

      const watermarkResult = await this.readDependencyWatermark();
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
  }
}
