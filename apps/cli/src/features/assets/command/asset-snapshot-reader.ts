import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { OverrideStore } from '@exitbook/data/overrides';
import { readAssetReviewDecisions, readExcludedAssetIds } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';

import { createCliAssetReviewProjectionRuntime } from '../../../runtime/asset-review-projection-runtime.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { formatAssetsFreshnessMessage } from '../../shared/balance-snapshot-freshness-message.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';

import type {
  AssetExclusionsResult,
  AssetSelectionParams,
  AssetsViewResult,
  AssetSnapshot,
  AssetViewItem,
  ViewAssetsParams,
} from './assets-types.js';
import { aggregateCurrentHoldings, mergeAssetSymbols } from './assets-types.js';
import { collectKnownAssets, findAssetsBySymbol, type KnownAssetRecord } from './assets-utils.js';

type AssetOverrideStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;
type AssetQueryDatabase = DataSession;

export class AssetSnapshotReader {
  constructor(
    private readonly db: AssetQueryDatabase,
    private readonly overrideStore: AssetOverrideStore,
    private readonly dataDir: string
  ) {}

  async listExclusions(profileId: number, profileKey: string): Promise<Result<AssetExclusionsResult, Error>> {
    const snapshotResult = await this.loadSnapshot(profileId, profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    if (snapshotResult.value.excludedAssetIds.size === 0) {
      return ok({ excludedAssets: [] });
    }

    const excludedAssets = [...snapshotResult.value.excludedAssetIds]
      .map((assetId) => {
        const knownAsset = snapshotResult.value.knownAssets.get(assetId);
        const currentHolding = snapshotResult.value.currentHoldings.get(assetId);
        return {
          assetId,
          assetSymbols: mergeAssetSymbols(knownAsset?.assetSymbols, currentHolding?.assetSymbols),
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

  async view(params: ViewAssetsParams): Promise<Result<AssetsViewResult, Error>> {
    const snapshotResult = await this.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const assetIds = new Set<string>([
      ...snapshotResult.value.knownAssets.keys(),
      ...snapshotResult.value.currentHoldings.keys(),
      ...snapshotResult.value.reviewSummaries.keys(),
    ]);

    const items = [...assetIds]
      .map<AssetViewItem>((assetId) => {
        const knownAsset = snapshotResult.value.knownAssets.get(assetId);
        const currentHolding = snapshotResult.value.currentHoldings.get(assetId);
        const reviewSummary = snapshotResult.value.reviewSummaries.get(assetId);
        return {
          assetId,
          assetSymbols: mergeAssetSymbols(knownAsset?.assetSymbols, currentHolding?.assetSymbols),
          accountingBlocked: reviewSummary?.accountingBlocked ?? false,
          movementCount: knownAsset?.movementCount ?? 0,
          transactionCount: knownAsset?.transactionCount ?? 0,
          currentQuantity: currentHolding?.currentQuantity ?? '0',
          evidence: reviewSummary?.evidence ?? [],
          excluded: snapshotResult.value.excludedAssetIds.has(assetId),
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

  async loadSnapshot(profileId: number, profileKey: string): Promise<Result<AssetSnapshot, Error>> {
    const transactionsResult = await this.db.transactions.findAll({ profileId, includeExcluded: true });
    if (transactionsResult.isErr()) {
      return err(new Error(`Failed to load transactions for asset resolution: ${transactionsResult.error.message}`));
    }

    const topLevelAccountsResult = await this.db.accounts.findAll({ profileId, topLevelOnly: true });
    if (topLevelAccountsResult.isErr()) {
      return err(new Error('Failed to resolve profile accounts for asset view'));
    }
    const scopeAccountIds = topLevelAccountsResult.value.map((account) => account.id);

    const freshnessResult = await this.assertFreshBalanceSnapshots(scopeAccountIds);
    if (freshnessResult.isErr()) {
      return err(freshnessResult.error);
    }

    const snapshotAssetsResult = await this.db.balanceSnapshots.findAssetsByScope(scopeAccountIds);
    if (snapshotAssetsResult.isErr()) {
      return err(new Error(`Failed to load balance snapshot assets: ${snapshotAssetsResult.error.message}`));
    }

    const excludedAssetIdsResult = await readExcludedAssetIds(this.overrideStore, profileKey);
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    const reviewDecisionsResult = await readAssetReviewDecisions(this.overrideStore, profileKey);
    if (reviewDecisionsResult.isErr()) {
      return err(reviewDecisionsResult.error);
    }

    const reviewSummariesResult = await this.readFreshReviewSummaries(profileId, profileKey);
    if (reviewSummariesResult.isErr()) {
      return err(reviewSummariesResult.error);
    }

    return ok({
      transactions: transactionsResult.value,
      currentHoldings: aggregateCurrentHoldings(snapshotAssetsResult.value, parseDecimal),
      knownAssets: collectKnownAssets(transactionsResult.value),
      excludedAssetIds: excludedAssetIdsResult.value,
      reviewDecisions: reviewDecisionsResult.value,
      reviewSummaries: reviewSummariesResult.value,
    });
  }

  async resolveSelection(
    params: AssetSelectionParams,
    snapshot: AssetSnapshot
  ): Promise<Result<{ assetId: string; assetSymbols: string[] }, Error>> {
    const exactAssetId = params.assetId?.trim();
    if (exactAssetId) {
      if (snapshot.excludedAssetIds.has(exactAssetId)) {
        return ok({
          assetId: exactAssetId,
          assetSymbols: mergeAssetSymbols(
            snapshot.knownAssets.get(exactAssetId)?.assetSymbols,
            snapshot.currentHoldings.get(exactAssetId)?.assetSymbols
          ),
        });
      }

      const knownAsset = snapshot.knownAssets.get(exactAssetId);
      const currentHolding = snapshot.currentHoldings.get(exactAssetId);
      if (!knownAsset && !currentHolding) {
        return err(new Error(`Asset ID not found: ${exactAssetId}`));
      }

      return ok({
        assetId: exactAssetId,
        assetSymbols: mergeAssetSymbols(knownAsset?.assetSymbols, currentHolding?.assetSymbols),
      });
    }

    const symbol = params.symbol?.trim();
    if (!symbol) {
      return err(new Error('Either --asset-id or --symbol is required'));
    }

    const matches = findAssetsBySymbol(buildSelectableAssets(snapshot).values(), symbol);
    if (matches.length === 0) {
      return err(new Error(`No asset found for symbol '${symbol.toUpperCase()}'`));
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

  async readFreshReviewSummaries(
    profileId: number,
    profileKey: string,
    assetIds?: string[]
  ): Promise<Result<Map<string, import('@exitbook/core').AssetReviewSummary>, Error>> {
    const assetReviewRuntimeResult = createCliAssetReviewProjectionRuntime(this.db, this.dataDir, {
      profileId,
      profileKey,
    });
    if (assetReviewRuntimeResult.isErr()) {
      return err(assetReviewRuntimeResult.error);
    }

    const freshProjectionResult = await assetReviewRuntimeResult.value.ensureFresh();
    if (freshProjectionResult.isErr()) {
      return err(freshProjectionResult.error);
    }

    return readAssetReviewProjectionSummaries(this.db, profileId, assetIds);
  }

  private async assertFreshBalanceSnapshots(scopeAccountIds: number[]): Promise<Result<void, Error>> {
    const freshnessPorts = buildBalancesFreshnessPorts(this.db);

    for (const scopeAccountId of scopeAccountIds) {
      const freshnessResult = await freshnessPorts.checkFreshness(scopeAccountId);
      if (freshnessResult.isErr()) {
        return err(freshnessResult.error);
      }

      if (freshnessResult.value.status === 'fresh') {
        continue;
      }

      return err(
        new Error(
          formatAssetsFreshnessMessage({
            scopeAccountId,
            status: freshnessResult.value.status,
            reason: freshnessResult.value.reason,
          })
        )
      );
    }

    return ok(undefined);
  }
}

function buildSelectableAssets(snapshot: AssetSnapshot): Map<string, KnownAssetRecord> {
  const selectableAssets = new Map<string, KnownAssetRecord>();

  for (const knownAsset of snapshot.knownAssets.values()) {
    selectableAssets.set(knownAsset.assetId, knownAsset);
  }

  for (const [assetId, currentHolding] of snapshot.currentHoldings.entries()) {
    const existing = selectableAssets.get(assetId);
    if (existing) {
      selectableAssets.set(assetId, {
        ...existing,
        assetSymbols: mergeAssetSymbols(existing.assetSymbols, currentHolding.assetSymbols),
      });
      continue;
    }

    selectableAssets.set(assetId, {
      assetId,
      assetSymbols: currentHolding.assetSymbols,
      movementCount: 0,
      transactionCount: 0,
    });
  }

  return selectableAssets;
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
