import type { CreateOverrideEventOptions } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import { invalidateAssetReviewProjection } from '../../shared/asset-review-projection-store.js';

import { AssetSnapshotReader } from './asset-snapshot-reader.js';
import type { AssetOverrideParams, AssetOverrideResult, AssetReviewOverrideResult } from './assets-types.js';

type AssetOverrideStore = Pick<OverrideStore, 'append'>;

export class AssetOverrideService {
  constructor(
    private readonly db: DataSession,
    private readonly overrideStore: AssetOverrideStore,
    private readonly snapshotReader: AssetSnapshotReader
  ) {}

  async exclude(params: AssetOverrideParams): Promise<Result<AssetOverrideResult, Error>> {
    const snapshotResult = await this.snapshotReader.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.snapshotReader.resolveSelection(params, snapshotResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    if (snapshotResult.value.excludedAssetIds.has(assetId)) {
      return ok({
        action: 'exclude',
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'asset-exclude',
      payload: {
        type: 'asset_exclude',
        asset_id: assetId,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    return ok({
      action: 'exclude',
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
    });
  }

  async include(params: AssetOverrideParams): Promise<Result<AssetOverrideResult, Error>> {
    const snapshotResult = await this.snapshotReader.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.snapshotReader.resolveSelection(params, snapshotResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    if (!snapshotResult.value.excludedAssetIds.has(assetId)) {
      return ok({
        action: 'include',
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'asset-include',
      payload: {
        type: 'asset_include',
        asset_id: assetId,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    return ok({
      action: 'include',
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
    });
  }

  async confirmReview(params: AssetOverrideParams): Promise<Result<AssetReviewOverrideResult, Error>> {
    const snapshotResult = await this.snapshotReader.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.snapshotReader.resolveSelection(params, snapshotResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    const reviewSummary = snapshotResult.value.reviewSummaries.get(assetId);
    if (!reviewSummary || reviewSummary.reviewStatus === 'clear') {
      return err(new Error(`Asset does not currently need review: ${assetId}`));
    }

    const currentDecision = snapshotResult.value.reviewDecisions.get(assetId);
    if (
      currentDecision?.action === 'confirm' &&
      currentDecision.evidenceFingerprint === reviewSummary.evidenceFingerprint &&
      reviewSummary.reviewStatus === 'reviewed'
    ) {
      return ok({
        action: 'confirm',
        ...toAssetReviewOverrideSnapshot(reviewSummary),
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'asset-review-confirm',
      payload: {
        type: 'asset_review_confirm',
        asset_id: assetId,
        evidence_fingerprint: reviewSummary.evidenceFingerprint,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const invalidateResult = await invalidateAssetReviewProjection(
      this.db,
      params.profileId,
      'override:asset-review-confirm'
    );
    if (invalidateResult.isErr()) {
      return err(invalidateResult.error);
    }

    const refreshedSummaryResult = await this.snapshotReader.readFreshReviewSummaries(
      params.profileId,
      params.profileKey,
      [assetId]
    );
    if (refreshedSummaryResult.isErr()) {
      return err(refreshedSummaryResult.error);
    }

    const refreshedSummary = refreshedSummaryResult.value.get(assetId);
    if (!refreshedSummary) {
      return err(new Error(`Asset review summary not found after confirmation rebuild: ${assetId}`));
    }

    return ok({
      action: 'confirm',
      ...toAssetReviewOverrideSnapshot(refreshedSummary),
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
    });
  }

  async clearReview(params: AssetOverrideParams): Promise<Result<AssetReviewOverrideResult, Error>> {
    const snapshotResult = await this.snapshotReader.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.snapshotReader.resolveSelection(params, snapshotResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    const reviewSummary = snapshotResult.value.reviewSummaries.get(assetId);
    if (!reviewSummary) {
      return err(new Error(`Asset review summary not found: ${assetId}`));
    }

    const currentDecision = snapshotResult.value.reviewDecisions.get(assetId);

    if (currentDecision?.action !== 'confirm') {
      return ok({
        action: 'clear-review',
        ...toAssetReviewOverrideSnapshot(reviewSummary),
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
      });
    }

    const appendResult = await this.appendOverride({
      profileKey: params.profileKey,
      scope: 'asset-review-clear',
      payload: {
        type: 'asset_review_clear',
        asset_id: assetId,
      },
      reason: params.reason,
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }

    const invalidateResult = await invalidateAssetReviewProjection(
      this.db,
      params.profileId,
      'override:asset-review-clear'
    );
    if (invalidateResult.isErr()) {
      return err(invalidateResult.error);
    }

    const refreshedSummaryResult = await this.snapshotReader.readFreshReviewSummaries(
      params.profileId,
      params.profileKey,
      [assetId]
    );
    if (refreshedSummaryResult.isErr()) {
      return err(refreshedSummaryResult.error);
    }

    const refreshedSummary = refreshedSummaryResult.value.get(assetId);
    if (!refreshedSummary) {
      return err(new Error(`Asset review summary not found after clear-review rebuild: ${assetId}`));
    }

    return ok({
      action: 'clear-review',
      ...toAssetReviewOverrideSnapshot(refreshedSummary),
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
    });
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return wrapError(appendResult.error, 'Failed to write asset override event');
    }

    return ok(undefined);
  }
}

function toAssetReviewOverrideSnapshot(
  reviewSummary: import('@exitbook/core').AssetReviewSummary
): Pick<
  AssetReviewOverrideResult,
  | 'accountingBlocked'
  | 'confirmationIsStale'
  | 'evidence'
  | 'evidenceFingerprint'
  | 'referenceStatus'
  | 'reviewStatus'
  | 'warningSummary'
> {
  return {
    accountingBlocked: reviewSummary.accountingBlocked,
    confirmationIsStale: reviewSummary.confirmationIsStale,
    evidence: reviewSummary.evidence,
    evidenceFingerprint: reviewSummary.evidenceFingerprint,
    referenceStatus: reviewSummary.referenceStatus,
    reviewStatus: reviewSummary.reviewStatus,
    warningSummary: reviewSummary.warningSummary,
  };
}
