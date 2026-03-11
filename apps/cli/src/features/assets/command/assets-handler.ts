import {
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

import { loadAssetReviewSummaries } from '../../shared/asset-review-runtime.js';
import type { CommandDatabase } from '../../shared/command-runtime.js';

import { collectKnownAssets, findAssetsBySymbol, type KnownAssetRecord } from './assets-utils.js';

type AssetOverrideStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type AssetQueryDatabase = Pick<CommandDatabase, 'transactions'>;

export interface AssetSelectionParams {
  assetId?: string | undefined;
  symbol?: string | undefined;
}

export interface AssetOverrideParams extends AssetSelectionParams {
  reason?: string | undefined;
}

export interface ViewAssetsParams {
  needsReview?: boolean | undefined;
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
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  confirmationIsStale: boolean;
  evidenceFingerprint: string;
  reason?: string | undefined;
  reviewState: AssetReviewStatus;
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
  confirmationIsStale: boolean;
  currentQuantity: string;
  evidenceFingerprint: string;
  excluded: boolean;
  movementCount: number;
  referenceStatus: AssetReferenceStatus;
  reviewState: AssetReviewStatus;
  reviewSummary?: string | undefined;
  transactionCount: number;
}

export interface AssetsViewResult {
  assets: AssetViewItem[];
  excludedCount: number;
  needsReviewCount: number;
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
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
        evidenceFingerprint: reviewSummary.evidenceFingerprint,
        reviewState: 'reviewed',
        confirmationIsStale: false,
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

    return ok({
      action: 'confirm',
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
      evidenceFingerprint: reviewSummary.evidenceFingerprint,
      reviewState: 'reviewed',
      confirmationIsStale: false,
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
    const nextReviewState: AssetReviewStatus = reviewSummary.evidence.length > 0 ? 'needs-review' : 'clear';

    if (currentDecision?.action !== 'confirm') {
      return ok({
        action: 'clear-review',
        assetId,
        assetSymbols,
        changed: false,
        reason: params.reason,
        evidenceFingerprint: reviewSummary.evidenceFingerprint,
        reviewState: nextReviewState,
        confirmationIsStale: false,
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

    return ok({
      action: 'clear-review',
      assetId,
      assetSymbols,
      changed: true,
      reason: params.reason,
      evidenceFingerprint: reviewSummary.evidenceFingerprint,
      reviewState: nextReviewState,
      confirmationIsStale: false,
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
          movementCount: knownAsset.movementCount,
          transactionCount: knownAsset.transactionCount,
          currentQuantity: balances[knownAsset.assetId]?.toFixed() ?? '0',
          excluded: snapshotResult.value.excludedAssetIds.has(knownAsset.assetId),
          reviewState: reviewSummary?.reviewStatus ?? 'clear',
          reviewSummary: reviewSummary?.warningSummary,
          referenceStatus: reviewSummary?.referenceStatus ?? 'unknown',
          confirmationIsStale: reviewSummary?.confirmationIsStale ?? false,
          evidenceFingerprint: reviewSummary?.evidenceFingerprint ?? `asset-review:v1:${knownAsset.assetId}`,
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

    const filteredItems = params.needsReview ? items.filter((item) => item.reviewState === 'needs-review') : items;

    return ok({
      assets: filteredItems,
      totalCount: items.length,
      needsReviewCount: items.filter((item) => item.reviewState === 'needs-review').length,
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

    const reviewSummariesResult = await loadAssetReviewSummaries(this.dataDir, transactionsResult.value);
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
  if (item.reviewState === 'needs-review') {
    return 0;
  }
  if (item.reviewState === 'reviewed') {
    return 1;
  }
  if (item.excluded) {
    return 2;
  }
  return 3;
}
