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
        reviewSummarySource: 'current',
        warnings: [],
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

    return await this.buildReviewOverrideResult({
      action: 'confirm',
      assetId,
      assetSymbols,
      changed: true,
      fallbackSummary: buildConfirmedReviewSummary(reviewSummary),
      profileId: params.profileId,
      profileKey: params.profileKey,
      reason: params.reason,
      staleReason: 'override:asset-review-confirm',
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
        reviewSummarySource: 'current',
        warnings: [],
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

    return await this.buildReviewOverrideResult({
      action: 'clear-review',
      assetId,
      assetSymbols,
      changed: true,
      fallbackSummary: buildClearedReviewSummary(reviewSummary),
      profileId: params.profileId,
      profileKey: params.profileKey,
      reason: params.reason,
      staleReason: 'override:asset-review-clear',
    });
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return wrapError(appendResult.error, 'Failed to write asset override event');
    }

    return ok(undefined);
  }

  private async buildReviewOverrideResult(input: {
    action: AssetReviewOverrideResult['action'];
    assetId: string;
    assetSymbols: string[];
    changed: boolean;
    fallbackSummary: import('@exitbook/core').AssetReviewSummary;
    profileId: number;
    profileKey: string;
    reason?: string | undefined;
    staleReason: string;
  }): Promise<Result<AssetReviewOverrideResult, Error>> {
    const warnings: string[] = [];

    const invalidateResult = await invalidateAssetReviewProjection(this.db, input.profileId, input.staleReason);
    if (invalidateResult.isErr()) {
      warnings.push(
        `Override persisted, but the asset review projection could not be marked stale: ${invalidateResult.error.message}`
      );
    }

    const refreshedSummaryResult = await this.snapshotReader.readFreshReviewSummaries(
      input.profileId,
      input.profileKey,
      [input.assetId]
    );
    if (refreshedSummaryResult.isOk()) {
      const refreshedSummary = refreshedSummaryResult.value.get(input.assetId);
      if (refreshedSummary) {
        return ok({
          action: input.action,
          ...toAssetReviewOverrideSnapshot(refreshedSummary),
          assetId: input.assetId,
          assetSymbols: input.assetSymbols,
          changed: input.changed,
          reason: input.reason,
          reviewSummarySource: 'refreshed',
          warnings,
        });
      }

      warnings.push(`Override persisted, but the refreshed asset review summary was missing for ${input.assetId}.`);
    } else {
      warnings.push(
        `Override persisted, but the asset review projection refresh failed: ${refreshedSummaryResult.error.message}`
      );
    }

    return ok({
      action: input.action,
      ...toAssetReviewOverrideSnapshot(input.fallbackSummary),
      assetId: input.assetId,
      assetSymbols: input.assetSymbols,
      changed: input.changed,
      reason: input.reason,
      reviewSummarySource: 'derived',
      warnings,
    });
  }
}

function buildConfirmedReviewSummary(
  reviewSummary: import('@exitbook/core').AssetReviewSummary
): import('@exitbook/core').AssetReviewSummary {
  return {
    ...reviewSummary,
    accountingBlocked: hasSameSymbolAmbiguity(reviewSummary),
    confirmationIsStale: false,
    reviewStatus: 'reviewed',
  };
}

function buildClearedReviewSummary(
  reviewSummary: import('@exitbook/core').AssetReviewSummary
): import('@exitbook/core').AssetReviewSummary {
  const reviewStatus = reviewSummary.evidence.length > 0 ? 'needs-review' : 'clear';

  return {
    ...reviewSummary,
    accountingBlocked:
      hasSameSymbolAmbiguity(reviewSummary) || (reviewStatus === 'needs-review' && hasErrorEvidence(reviewSummary)),
    confirmationIsStale: false,
    reviewStatus,
  };
}

function hasSameSymbolAmbiguity(reviewSummary: import('@exitbook/core').AssetReviewSummary): boolean {
  return reviewSummary.evidence.some((item) => item.kind === 'same-symbol-ambiguity');
}

function hasErrorEvidence(reviewSummary: import('@exitbook/core').AssetReviewSummary): boolean {
  return reviewSummary.evidence.some((item) => item.severity === 'error');
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
