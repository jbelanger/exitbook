import type { AssetReviewSummary, Result, UniversalTransactionData } from '@exitbook/core';

import type { AssetReviewDecisionInput } from '../features/asset-review/asset-review-service.js';

export interface IAssetReviewProjectionDataSource {
  listTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
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
