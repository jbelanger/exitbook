import { applyAssetExclusionsToReviewSummary } from '@exitbook/core';
import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { OverrideStore } from '@exitbook/data/overrides';
import { readAssetReviewDecisions, readExcludedAssetIds } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';

import { formatAccountFingerprintRef } from '../../accounts/account-selector.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { formatAssetsFreshnessMessage } from '../../shared/balance-snapshot-freshness-message.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';

import { createCliAssetReviewProjectionRuntime } from './asset-review-projection-runtime.js';
import type {
  AssetsBrowseResult,
  AssetExclusionsResult,
  AssetSelectionParams,
  AssetsViewResult,
  AssetSnapshot,
  AssetViewItem,
  BrowseAssetsParams,
  ViewAssetsParams,
} from './assets-types.js';
import { aggregateCurrentHoldings, mergeAssetSymbols } from './assets-types.js';
import { collectKnownAssets, findAssetsBySymbol, type KnownAssetRecord } from './assets-utils.js';

type AssetOverrideStore = Pick<OverrideStore, 'exists' | 'readByScopes'>;
type AssetQueryDatabase = DataSession;

export interface BalanceSnapshotRebuilder {
  rebuildCalculatedSnapshot(scopeAccountId: number): Promise<Result<void, Error>>;
}

export class AssetSnapshotReader {
  constructor(
    private readonly db: AssetQueryDatabase,
    private readonly overrideStore: AssetOverrideStore,
    private readonly dataDir: string,
    private readonly balanceSnapshotRebuilder?: BalanceSnapshotRebuilder | undefined
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
    const browseResult = await this.browse(params);
    if (browseResult.isErr()) {
      return err(browseResult.error);
    }

    return ok({
      actionRequiredCount: browseResult.value.actionRequiredCount,
      assets: browseResult.value.assets,
      excludedCount: browseResult.value.excludedCount,
      totalCount: browseResult.value.totalCount,
    });
  }

  async browse(params: BrowseAssetsParams): Promise<Result<AssetsBrowseResult, Error>> {
    const snapshotResult = await this.loadSnapshot(params.profileId, params.profileKey);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const items = buildAssetViewItems(snapshotResult.value);
    const filteredItems = filterBrowseItems(items, params.actionRequiredOnly);
    const selectedAssetResult = resolveSelectedAsset(snapshotResult.value, items, params.selector);
    if (selectedAssetResult.isErr()) {
      return err(selectedAssetResult.error);
    }

    return ok({
      actionRequiredCount: items.filter(requiresAssetReviewAction).length,
      allAssets: items,
      assets: filteredItems,
      totalCount: items.length,
      excludedCount: items.filter((item) => item.excluded).length,
      selectedAsset: selectedAssetResult.value,
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

    const freshnessResult = await this.ensureBalanceSnapshotsReady(topLevelAccountsResult.value);
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
      return resolveExactAssetSelection(snapshot, exactAssetId);
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

    const reviewSummariesResult = await readAssetReviewProjectionSummaries(this.db, profileId, assetIds);
    if (reviewSummariesResult.isErr()) {
      return err(reviewSummariesResult.error);
    }

    const excludedAssetIdsResult = await readExcludedAssetIds(this.overrideStore, profileKey);
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    return ok(
      new Map(
        [...reviewSummariesResult.value.entries()].map(([assetId, summary]) => [
          assetId,
          applyAssetExclusionsToReviewSummary(summary, excludedAssetIdsResult.value),
        ])
      )
    );
  }

  private async ensureBalanceSnapshotsReady(
    scopeAccounts: {
      accountFingerprint: string;
      id: number;
    }[]
  ): Promise<Result<void, Error>> {
    const freshnessPorts = buildBalancesFreshnessPorts(this.db);
    const staleScopeAccounts: {
      accountFingerprint: string;
      id: number;
    }[] = [];

    for (const scopeAccount of scopeAccounts) {
      const freshnessResult = await freshnessPorts.checkFreshness(scopeAccount.id);
      if (freshnessResult.isErr()) {
        return err(freshnessResult.error);
      }

      if (freshnessResult.value.status === 'fresh') {
        continue;
      }

      if (freshnessResult.value.status !== 'stale' || this.balanceSnapshotRebuilder === undefined) {
        return err(
          new Error(
            formatAssetsFreshnessMessage({
              scopeAccountRef: formatAccountFingerprintRef(scopeAccount.accountFingerprint),
              status: freshnessResult.value.status,
              reason: freshnessResult.value.reason,
            })
          )
        );
      }

      staleScopeAccounts.push(scopeAccount);
    }

    const balanceSnapshotRebuilder = this.balanceSnapshotRebuilder;
    if (balanceSnapshotRebuilder === undefined) {
      if (staleScopeAccounts.length > 0) {
        return err(new Error('Balance snapshot rebuilder is not configured for assets commands.'));
      }

      return ok(undefined);
    }

    for (const scopeAccount of staleScopeAccounts) {
      const rebuildResult = await balanceSnapshotRebuilder.rebuildCalculatedSnapshot(scopeAccount.id);
      if (rebuildResult.isErr()) {
        return err(
          formatBalanceSnapshotRebuildError(
            formatAccountFingerprintRef(scopeAccount.accountFingerprint),
            rebuildResult.error
          )
        );
      }
    }

    for (const scopeAccount of staleScopeAccounts) {
      const freshnessResult = await freshnessPorts.checkFreshness(scopeAccount.id);
      if (freshnessResult.isErr()) {
        return err(freshnessResult.error);
      }

      if (freshnessResult.value.status === 'fresh') {
        continue;
      }

      return err(
        new Error(
          formatAssetsFreshnessMessage({
            scopeAccountRef: formatAccountFingerprintRef(scopeAccount.accountFingerprint),
            status: freshnessResult.value.status,
            reason: freshnessResult.value.reason,
          })
        )
      );
    }

    return ok(undefined);
  }
}

function formatBalanceSnapshotRebuildError(scopeAccountRef: string, error: Error): Error {
  if (error.message.startsWith('No imported transaction data found for ')) {
    return new Error(
      `Assets could not rebuild saved balances for scope account ${scopeAccountRef}. ` +
        'This account has no imported transaction data yet. ' +
        'Run "exitbook import" first, then rerun the same assets command.'
    );
  }

  if (error.message.startsWith('No completed import found for ')) {
    return new Error(
      `Assets could not rebuild saved balances for scope account ${scopeAccountRef}. ` +
        'This account has import sessions, but none completed successfully yet. ' +
        'Run "exitbook import" successfully before rerunning the same assets command.'
    );
  }

  return new Error(`Assets could not rebuild saved balances for scope account ${scopeAccountRef}: ${error.message}`);
}

function resolveSelectedAsset(
  snapshot: AssetSnapshot,
  items: AssetViewItem[],
  selector: string | undefined
): Result<AssetViewItem | undefined, Error> {
  if (!selector) {
    return ok(undefined);
  }

  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return err(new Error('Asset selector cannot be empty'));
  }

  const exactSelection = resolveExactAssetSelection(snapshot, trimmedSelector);
  if (exactSelection.isErr()) {
    return exactSelection.error.message === `Asset ID not found: ${trimmedSelector}`
      ? resolveSelectedAssetBySymbol(snapshot, items, trimmedSelector)
      : err(exactSelection.error);
  }

  const selectedAsset = items.find((item) => item.assetId === exactSelection.value.assetId);
  if (!selectedAsset) {
    return err(new Error(`Selected asset is not visible in the asset browse model: ${exactSelection.value.assetId}`));
  }

  return ok(selectedAsset);
}

function resolveExactAssetSelection(
  snapshot: AssetSnapshot,
  assetId: string
): Result<{ assetId: string; assetSymbols: string[] }, Error> {
  if (snapshot.excludedAssetIds.has(assetId)) {
    return ok({
      assetId,
      assetSymbols: mergeAssetSymbols(
        snapshot.knownAssets.get(assetId)?.assetSymbols,
        snapshot.currentHoldings.get(assetId)?.assetSymbols
      ),
    });
  }

  const knownAsset = snapshot.knownAssets.get(assetId);
  const currentHolding = snapshot.currentHoldings.get(assetId);
  if (!knownAsset && !currentHolding) {
    return err(new Error(`Asset ID not found: ${assetId}`));
  }

  return ok({
    assetId,
    assetSymbols: mergeAssetSymbols(knownAsset?.assetSymbols, currentHolding?.assetSymbols),
  });
}

function resolveSelectedAssetBySymbol(
  snapshot: AssetSnapshot,
  items: AssetViewItem[],
  symbol: string
): Result<AssetViewItem, Error> {
  const matches = findAssetsBySymbol(buildSelectableAssets(snapshot).values(), symbol);
  if (matches.length === 0) {
    return err(new Error(`No asset found for selector '${symbol.toUpperCase()}'`));
  }

  if (matches.length > 1) {
    const candidateList = matches.map((match) => `${match.assetId} (${match.transactionCount} txs)`).join(', ');
    return err(
      new Error(
        `Selector '${symbol.toUpperCase()}' is ambiguous across multiple asset IDs: ${candidateList}. Re-run with an exact asset ID.`
      )
    );
  }

  const selectedAsset = items.find((item) => item.assetId === matches[0]!.assetId);
  if (!selectedAsset) {
    return err(new Error(`Selected asset is not visible in the asset browse model: ${matches[0]!.assetId}`));
  }

  return ok(selectedAsset);
}

function buildAssetViewItems(snapshot: AssetSnapshot): AssetViewItem[] {
  const assetIds = new Set<string>([
    ...snapshot.knownAssets.keys(),
    ...snapshot.currentHoldings.keys(),
    ...snapshot.reviewSummaries.keys(),
  ]);

  return [...assetIds]
    .map<AssetViewItem>((assetId) => {
      const knownAsset = snapshot.knownAssets.get(assetId);
      const currentHolding = snapshot.currentHoldings.get(assetId);
      const reviewSummary = snapshot.reviewSummaries.get(assetId);
      return {
        assetId,
        assetSymbols: mergeAssetSymbols(knownAsset?.assetSymbols, currentHolding?.assetSymbols),
        accountingBlocked: reviewSummary?.accountingBlocked ?? false,
        movementCount: knownAsset?.movementCount ?? 0,
        transactionCount: knownAsset?.transactionCount ?? 0,
        currentQuantity: currentHolding?.currentQuantity ?? '0',
        evidence: reviewSummary?.evidence ?? [],
        excluded: snapshot.excludedAssetIds.has(assetId),
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
}

function filterBrowseItems(items: AssetViewItem[], actionRequiredOnly: boolean | undefined): AssetViewItem[] {
  if (actionRequiredOnly) {
    return items.filter(requiresAssetReviewAction);
  }

  return items.filter((item) => item.currentQuantity !== '0' || item.excluded || requiresAssetReviewAction(item));
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
