import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type {
  CostBasisDependencyWatermark,
  CostBasisFailureConsumer,
  CostBasisFailureSnapshotRecord,
  ICostBasisFailureSnapshotStore,
} from '../../ports/cost-basis-persistence.js';
import type { CostBasisInput } from '../shared/cost-basis-utils.js';

import { buildCostBasisScopeKey } from './cost-basis-artifact-storage.js';

const logger = getLogger('cost-basis-failure-snapshot-service');

interface PersistCostBasisFailureSnapshotParams {
  consumer: CostBasisFailureConsumer;
  input: CostBasisInput;
  dependencyWatermark: CostBasisDependencyWatermark;
  error: Error;
  stage: string;
  context?: Record<string, unknown> | undefined;
}

export async function persistCostBasisFailureSnapshot(
  store: ICostBasisFailureSnapshotStore,
  params: PersistCostBasisFailureSnapshotParams
): Promise<Result<{ scopeKey: string; snapshotId: string }, Error>> {
  const config = params.input.config;

  const debugPayload = {
    stage: params.stage,
    ...(params.context ? { context: params.context } : {}),
  };

  let debugJson: string;
  try {
    debugJson = JSON.stringify(debugPayload);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  const scopeKey = buildCostBasisScopeKey(config);
  const snapshotId = globalThis.crypto.randomUUID();
  const timestamp = new Date();
  const snapshot: CostBasisFailureSnapshotRecord = {
    scopeKey,
    consumer: params.consumer,
    snapshotId,
    linksStatus: params.dependencyWatermark.links.status,
    ...(params.dependencyWatermark.links.lastBuiltAt
      ? { linksBuiltAt: params.dependencyWatermark.links.lastBuiltAt }
      : {}),
    assetReviewStatus: params.dependencyWatermark.assetReview.status,
    ...(params.dependencyWatermark.assetReview.lastBuiltAt
      ? { assetReviewBuiltAt: params.dependencyWatermark.assetReview.lastBuiltAt }
      : {}),
    ...(params.dependencyWatermark.pricesLastMutatedAt
      ? { pricesLastMutatedAt: params.dependencyWatermark.pricesLastMutatedAt }
      : {}),
    exclusionFingerprint: params.dependencyWatermark.exclusionFingerprint,
    jurisdiction: config.jurisdiction,
    method: config.method,
    taxYear: config.taxYear,
    displayCurrency: config.currency,
    startDate: config.startDate.toISOString(),
    endDate: config.endDate.toISOString(),
    errorName: params.error.name,
    errorMessage: params.error.message,
    ...(params.error.stack ? { errorStack: params.error.stack } : {}),
    debugJson,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const persistResult = await store.replaceLatest(snapshot);
  if (persistResult.isErr()) {
    return err(persistResult.error);
  }

  logger.warn(
    {
      consumer: params.consumer,
      scopeKey,
      snapshotId,
      stage: params.stage,
      errorMessage: params.error.message,
    },
    'Persisted cost-basis failure snapshot'
  );

  return ok({ scopeKey, snapshotId });
}
