import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type {
  CostBasisDependencyWatermark,
  ICostBasisArtifactStore,
  ICostBasisContextReader,
} from '../../ports/cost-basis-persistence.js';
import type { AccountingExclusionPolicy } from '../standard/validation/accounting-exclusion-policy.js';
import type { ValidatedCostBasisConfig } from '../workflow/cost-basis-input.js';
import type { CostBasisWorkflow, CostBasisWorkflowResult } from '../workflow/cost-basis-workflow.js';

import {
  buildCostBasisSnapshotRecord,
  buildCostBasisScopeKey,
  evaluateCostBasisArtifactFreshness,
  readCostBasisSnapshotArtifact,
  type CostBasisArtifactDebugPayload,
} from './artifact-storage.js';

const logger = getLogger('cost-basis.artifacts.service');

interface CostBasisArtifactServiceExecuteParams {
  config: ValidatedCostBasisConfig;
  dependencyWatermark: CostBasisDependencyWatermark;
  refresh?: boolean | undefined;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, import('@exitbook/core').AssetReviewSummary> | undefined;
}

interface CostBasisArtifactServiceResult {
  artifact: CostBasisWorkflowResult;
  debug: CostBasisArtifactDebugPayload;
  dependencyWatermark: CostBasisDependencyWatermark;
  rebuilt: boolean;
  scopeKey: string;
  snapshotId: string;
}

export class CostBasisArtifactService {
  constructor(
    private readonly contextReader: ICostBasisContextReader,
    private readonly artifactStore: ICostBasisArtifactStore,
    private readonly workflow: CostBasisWorkflow
  ) {}

  async execute(params: CostBasisArtifactServiceExecuteParams): Promise<Result<CostBasisArtifactServiceResult, Error>> {
    const scopeKey = buildCostBasisScopeKey(params.config);

    if (!params.refresh) {
      const latestResult = await this.artifactStore.findLatest(scopeKey);
      if (latestResult.isErr()) {
        return err(latestResult.error);
      }

      if (latestResult.value) {
        const freshness = evaluateCostBasisArtifactFreshness(latestResult.value, params.dependencyWatermark);
        if (freshness.status === 'fresh') {
          const reuseResult = readCostBasisSnapshotArtifact(latestResult.value);
          if (reuseResult.isOk()) {
            logger.info({ scopeKey, snapshotId: reuseResult.value.snapshotId }, 'Reusing fresh cost-basis snapshot');
            return ok({
              artifact: reuseResult.value.artifact,
              debug: reuseResult.value.debug,
              dependencyWatermark: params.dependencyWatermark,
              rebuilt: false,
              scopeKey,
              snapshotId: reuseResult.value.snapshotId,
            });
          }

          logger.warn(
            { scopeKey, snapshotId: latestResult.value.snapshotId, error: reuseResult.error.message },
            'Fresh cost-basis snapshot was unreadable and will be rebuilt'
          );
        } else {
          logger.info(
            { scopeKey, snapshotId: latestResult.value.snapshotId, reason: freshness.reason },
            'Stored cost-basis snapshot is stale'
          );
        }
      }
    }

    const contextResult = await this.contextReader.loadCostBasisContext();
    if (contextResult.isErr()) {
      return err(contextResult.error);
    }

    const workflowResult = await this.workflow.execute(params.config, contextResult.value.transactions, {
      accountingExclusionPolicy: params.accountingExclusionPolicy,
      assetReviewSummaries: params.assetReviewSummaries,
      // Tax reporting must fail closed. Excluding a disposal or transfer
      // because it lacks prices would understate realized activity.
      missingPricePolicy: 'error',
    });
    if (workflowResult.isErr()) {
      return err(workflowResult.error);
    }

    const snapshotResult = buildCostBasisSnapshotRecord(workflowResult.value, params.dependencyWatermark, scopeKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const persistResult = await this.artifactStore.replaceLatest(snapshotResult.value.snapshot);
    if (persistResult.isErr()) {
      return err(persistResult.error);
    }

    logger.info({ scopeKey, snapshotId: snapshotResult.value.snapshotId }, 'Persisted cost-basis snapshot');

    return ok({
      artifact: snapshotResult.value.artifact,
      debug: snapshotResult.value.debug,
      dependencyWatermark: params.dependencyWatermark,
      rebuilt: true,
      scopeKey,
      snapshotId: snapshotResult.value.snapshotId,
    });
  }
}
