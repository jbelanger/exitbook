import type { AssetReviewSummary, ProjectionStatus, Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { AssetReviewDecisionInput } from '../features/asset-review/asset-review-service.js';

export interface IAssetReviewProjectionDataSource {
  listTransactions(): Promise<Result<Transaction[], Error>>;
}

export interface IAssetReviewDecisionSource {
  loadReviewDecisions(): Promise<Result<ReadonlyMap<string, AssetReviewDecisionInput>, Error>>;
}

export interface IAssetReviewProjectionStore {
  markAssetReviewBuilding(): Promise<Result<void, Error>>;
  replaceAssetReviewProjection(
    summaries: Iterable<AssetReviewSummary>,
    metadata: { assetCount: number }
  ): Promise<Result<void, Error>>;
  markAssetReviewFailed(): Promise<Result<void, Error>>;
}

export type AssetReviewProjectionPorts = IAssetReviewProjectionDataSource &
  IAssetReviewDecisionSource &
  IAssetReviewProjectionStore;

export interface AssetReviewProjectionFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

export interface IAssetReviewProjectionFreshness {
  checkAssetReviewFreshness(): Promise<Result<AssetReviewProjectionFreshnessResult, Error>>;
}

export interface IAssetReviewProjectionBuildStateReader {
  getLastAssetReviewBuiltAt(): Promise<Result<Date | undefined, Error>>;
}

export interface IAssetReviewOverrideFreshness {
  findLatestAssetReviewOverrideAt(): Promise<Result<Date | undefined, Error>>;
}

export type AssetReviewProjectionRuntimePorts = AssetReviewProjectionPorts &
  IAssetReviewProjectionFreshness &
  IAssetReviewProjectionBuildStateReader &
  IAssetReviewOverrideFreshness;
