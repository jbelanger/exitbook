import {
  type AssetReviewEvidence,
  type AssetReferenceStatus,
  type AssetReviewStatus,
  type AssetReviewSummary,
  type UniversalTransactionData,
  err,
  ok,
  type CreateOverrideEventOptions,
  type Result,
} from '@exitbook/core';
import {
  readAssetReviewDecisions,
  readExcludedAssetIds,
  type AssetReviewDecision,
  type OverrideStore,
} from '@exitbook/data';
import { calculateBalances } from '@exitbook/ingestion';

import {
  invalidateAssetReviewProjection,
  readAssetReviewProjection,
} from '../../shared/asset-review-projection-runtime.js';
import type { CommandDatabase } from '../../shared/command-runtime.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';

import { collectKnownAssets, findAssetsBySymbol, type KnownAssetRecord } from './assets-utils.js';

type AssetOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type AssetQueryDatabase = CommandDatabase;

export interface AssetSelectionParams {
  assetId?: string | undefined;
  symbol?: string | undefined;
}

export interface AssetOverrideParams extends AssetSelectionParams {
  reason?: string | undefined;
}

export interface ViewAssetsParams {
  actionRequiredOnly?: boolean | undefined;
}

export interface AssetOverrideResult {
  action: 'exclude' | 'include';
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  reason?: string | undefined;
}

export interface AssetReviewOverrideResult {
  action: 'clear-review' | 'confirm';
  accountingBlocked: boolean;
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  confirmationIsStale: boolean;
  evidence: AssetReviewEvidence[];
  evidenceFingerprint: string;
  referenceStatus: AssetReferenceStatus;
  reason?: string | undefined;
  reviewStatus: AssetReviewStatus;
  warningSummary?: string | undefined;
}

export interface ExcludedAssetSummary {
  assetId: string;
  assetSymbols: string[];
  movementCount: number;
  transactionCount: number;
}

export interface AssetExclusionsResult {
  excludedAssets: ExcludedAssetSummary[];
}

export interface AssetViewItem {
  assetId: string;
  assetSymbols: string[];
  accountingBlocked: boolean;
  confirmationIsStale: boolean;
  currentQuantity: string;
  evidence: AssetReviewEvidence[];
  evidenceFingerprint?: string | undefined;
  excluded: boolean;
  movementCount: number;
  referenceStatus: AssetReferenceStatus;
  reviewStatus: AssetReviewStatus;
  warningSummary?: string | undefined;
  transactionCount: number;
}

export interface AssetsViewResult {
  actionRequiredCount: number;
  assets: AssetViewItem[];
  excludedCount: number;
  totalCount: number;
}

interface AssetSnapshot {
  excludedAssetIds: Set<string>;
  knownAssets: Map<string, KnownAssetRecord>;
  reviewDecisions: Map<string, AssetReviewDecision>;
  reviewSummaries: Map<string, AssetReviewSummary>;
  transactions: UniversalTransactionData[];
}

export class AssetsHandler {
  constructor(
    private readonly db: AssetQueryDatabase,
    private readonly overrideStore: AssetOverrideStore,
    private readonly dataDir: string
  ) {}

  async exclude(params: AssetOverrideParams): Promise<Result<AssetOverrideResult, Error>> {
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.resolveSelection(params, snapshotResult.value);
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
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.resolveSelection(params, snapshotResult.value);
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
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.resolveSelection(params, snapshotResult.value);
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

    const invalidateResult = await invalidateAssetReviewProjection(this.db, 'override:asset-review-confirm');
    if (invalidateResult.isErr()) {
      return err(invalidateResult.error);
    }

    const refreshedSummaryResult = await readAssetReviewProjection(this.db, this.dataDir, [assetId]);
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
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const selectionResult = await this.resolveSelection(params, snapshotResult.value);
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

    const invalidateResult = await invalidateAssetReviewProjection(this.db, 'override:asset-review-clear');
    if (invalidateResult.isErr()) {
      return err(invalidateResult.error);
    }

    const refreshedSummaryResult = await readAssetReviewProjection(this.db, this.dataDir, [assetId]);
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

  async listExclusions(): Promise<Result<AssetExclusionsResult, Error>> {
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    if (snapshotResult.value.excludedAssetIds.size === 0) {
      return ok({ excludedAssets: [] });
    }

    const excludedAssets = [...snapshotResult.value.excludedAssetIds]
      .map((assetId) => {
        const knownAsset = snapshotResult.value.knownAssets.get(assetId);
        return {
          assetId,
          assetSymbols: knownAsset?.assetSymbols ?? [],
          movementCount: knownAsset?.movementCount ?? 0,
          transactionCount: knownAsset?.transactionCount ?? 0,
        };
      })
      .sort((left, right) => {
        if (right.transactionCount !== left.transactionCount) {
          return right.transactionCount - left.transactionCount;
        }

        return left.assetId.localeCompare(right.assetId);
      });

    return ok({ excludedAssets });
  }

  async view(params: ViewAssetsParams = {}): Promise<Result<AssetsViewResult, Error>> {
    const snapshotResult = await this.loadSnapshot();
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const { balances } = calculateBalances(snapshotResult.value.transactions);
    const items = [...snapshotResult.value.knownAssets.values()]
      .map<AssetViewItem>((knownAsset) => {
        const reviewSummary = snapshotResult.value.reviewSummaries.get(knownAsset.assetId);
        return {
          assetId: knownAsset.assetId,
          assetSymbols: knownAsset.assetSymbols,
          accountingBlocked: reviewSummary?.accountingBlocked ?? false,
          movementCount: knownAsset.movementCount,
          transactionCount: knownAsset.transactionCount,
          currentQuantity: balances[knownAsset.assetId]?.toFixed() ?? '0',
          evidence: reviewSummary?.evidence ?? [],
          excluded: snapshotResult.value.excludedAssetIds.has(knownAsset.assetId),
          reviewStatus: reviewSummary?.reviewStatus ?? 'clear',
          warningSummary: reviewSummary?.warningSummary,
          referenceStatus: reviewSummary?.referenceStatus ?? 'unknown',
          confirmationIsStale: reviewSummary?.confirmationIsStale ?? false,
          evidenceFingerprint: reviewSummary?.evidenceFingerprint,
        };
      })
      .sort((left, right) => {
        const leftPriority = getAssetSortPriority(left);
        const rightPriority = getAssetSortPriority(right);
        return (
          leftPriority - rightPriority ||
          right.transactionCount - left.transactionCount ||
          left.assetId.localeCompare(right.assetId)
        );
      });

    const filteredItems = params.actionRequiredOnly ? items.filter(requiresAssetReviewAction) : items;

    return ok({
      actionRequiredCount: items.filter(requiresAssetReviewAction).length,
      assets: filteredItems,
      totalCount: items.length,
      excludedCount: items.filter((item) => item.excluded).length,
    });
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write asset override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }

  private async loadSnapshot(): Promise<Result<AssetSnapshot, Error>> {
    const transactionsResult = await this.db.transactions.findAll({ includeExcluded: true });
    if (transactionsResult.isErr()) {
      return err(new Error(`Failed to load transactions for asset resolution: ${transactionsResult.error.message}`));
    }

    const excludedAssetIdsResult = await readExcludedAssetIds(this.overrideStore);
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    const reviewDecisionsResult = await readAssetReviewDecisions(this.overrideStore);
    if (reviewDecisionsResult.isErr()) {
      return err(reviewDecisionsResult.error);
    }

    const reviewSummariesResult = await readAssetReviewProjection(this.db, this.dataDir);
    if (reviewSummariesResult.isErr()) {
      return err(reviewSummariesResult.error);
    }

    return ok({
      transactions: transactionsResult.value,
      knownAssets: collectKnownAssets(transactionsResult.value),
      excludedAssetIds: excludedAssetIdsResult.value,
      reviewDecisions: reviewDecisionsResult.value,
      reviewSummaries: reviewSummariesResult.value,
    });
  }

  private async resolveSelection(
    params: AssetSelectionParams,
    snapshot: AssetSnapshot
  ): Promise<Result<{ assetId: string; assetSymbols: string[] }, Error>> {
    const exactAssetId = params.assetId?.trim();
    if (exactAssetId) {
      if (snapshot.excludedAssetIds.has(exactAssetId)) {
        return ok({
          assetId: exactAssetId,
          assetSymbols: snapshot.knownAssets.get(exactAssetId)?.assetSymbols ?? [],
        });
      }

      const knownAsset = snapshot.knownAssets.get(exactAssetId);
      if (!knownAsset) {
        return err(new Error(`Asset ID not found in processed transactions: ${exactAssetId}`));
      }

      return ok({
        assetId: knownAsset.assetId,
        assetSymbols: knownAsset.assetSymbols,
      });
    }

    const symbol = params.symbol?.trim();
    if (!symbol) {
      return err(new Error('Either --asset-id or --symbol is required'));
    }

    const matches = findAssetsBySymbol(snapshot.knownAssets.values(), symbol);
    if (matches.length === 0) {
      return err(new Error(`No processed asset found for symbol '${symbol.toUpperCase()}'`));
    }

    if (matches.length > 1) {
      const candidateList = matches.map((match) => `${match.assetId} (${match.transactionCount} txs)`).join(', ');

      return err(
        new Error(
          `Symbol '${symbol.toUpperCase()}' is ambiguous across multiple asset IDs: ${candidateList}. Re-run with --asset-id.`
        )
      );
    }

    const match = matches[0]!;
    return ok({
      assetId: match.assetId,
      assetSymbols: match.assetSymbols,
    });
  }
}

function getAssetSortPriority(item: AssetViewItem): number {
  if (item.reviewStatus === 'needs-review') {
    return 0;
  }
  if (item.reviewStatus === 'reviewed') {
    return 1;
  }
  if (item.excluded) {
    return 2;
  }
  return 3;
}

function toAssetReviewOverrideSnapshot(
  reviewSummary: AssetReviewSummary
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
