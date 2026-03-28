import type { AssetReviewSummary, ProjectionStatus, Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { AssetReviewDecisionInput } from '../features/asset-review/asset-review-service.js';

export interface AssetReviewProjectionWorkflowPorts {
  listTransactions(): Promise<Result<Transaction[], Error>>;
  loadReviewDecisions(): Promise<Result<ReadonlyMap<string, AssetReviewDecisionInput>, Error>>;
  markAssetReviewBuilding(): Promise<Result<void, Error>>;
  replaceAssetReviewProjection(
    summaries: Iterable<AssetReviewSummary>,
    metadata: { assetCount: number }
  ): Promise<Result<void, Error>>;
  markAssetReviewFailed(): Promise<Result<void, Error>>;
}

export interface AssetReviewProjectionFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

export interface AssetReviewProjectionRuntimePorts extends AssetReviewProjectionWorkflowPorts {
  checkAssetReviewFreshness(): Promise<Result<AssetReviewProjectionFreshnessResult, Error>>;
  getLastAssetReviewBuiltAt(): Promise<Result<Date | undefined, Error>>;
  findLatestAssetReviewOverrideAt(): Promise<Result<Date | undefined, Error>>;
}
