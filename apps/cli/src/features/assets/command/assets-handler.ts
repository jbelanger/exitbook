import { err, ok, type CreateOverrideEventOptions, type Result } from '@exitbook/core';
import { readExcludedAssetIds, type OverrideStore } from '@exitbook/data';

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

export interface AssetOverrideResult {
  action: 'exclude' | 'include';
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  reason?: string | undefined;
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

export class AssetsHandler {
  constructor(
    private readonly db: AssetQueryDatabase,
    private readonly overrideStore: AssetOverrideStore
  ) {}

  async exclude(params: AssetOverrideParams): Promise<Result<AssetOverrideResult, Error>> {
    const excludedAssetIdsResult = await this.readExcludedAssetIds();
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    const selectionResult = await this.resolveSelection(params, excludedAssetIdsResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    if (excludedAssetIdsResult.value.has(assetId)) {
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
    const excludedAssetIdsResult = await this.readExcludedAssetIds();
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    const selectionResult = await this.resolveSelection(params, excludedAssetIdsResult.value);
    if (selectionResult.isErr()) {
      return err(selectionResult.error);
    }

    const { assetId, assetSymbols } = selectionResult.value;
    if (!excludedAssetIdsResult.value.has(assetId)) {
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

  async listExclusions(): Promise<Result<AssetExclusionsResult, Error>> {
    const excludedAssetIdsResult = await this.readExcludedAssetIds();
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    if (excludedAssetIdsResult.value.size === 0) {
      return ok({ excludedAssets: [] });
    }

    const knownAssetsResult = await this.loadKnownAssets();
    if (knownAssetsResult.isErr()) {
      return err(knownAssetsResult.error);
    }

    const excludedAssets = [...excludedAssetIdsResult.value]
      .map((assetId) => {
        const knownAsset = knownAssetsResult.value.get(assetId);
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

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write asset override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }

  private async loadKnownAssets(): Promise<Result<Map<string, KnownAssetRecord>, Error>> {
    const transactionsResult = await this.db.transactions.findAll({ includeExcluded: true });
    if (transactionsResult.isErr()) {
      return err(new Error(`Failed to load transactions for asset resolution: ${transactionsResult.error.message}`));
    }

    return ok(collectKnownAssets(transactionsResult.value));
  }

  private async readExcludedAssetIds(): Promise<Result<Set<string>, Error>> {
    const excludedAssetIdsResult = await readExcludedAssetIds(this.overrideStore);
    if (excludedAssetIdsResult.isErr()) {
      return err(excludedAssetIdsResult.error);
    }

    return ok(excludedAssetIdsResult.value);
  }

  private async resolveSelection(
    params: AssetSelectionParams,
    excludedAssetIds: Set<string>
  ): Promise<Result<{ assetId: string; assetSymbols: string[] }, Error>> {
    const exactAssetId = params.assetId?.trim();
    if (exactAssetId) {
      const knownAssetsResult = await this.loadKnownAssets();
      if (knownAssetsResult.isErr()) {
        return err(knownAssetsResult.error);
      }

      if (excludedAssetIds.has(exactAssetId)) {
        return ok({
          assetId: exactAssetId,
          assetSymbols: knownAssetsResult.value.get(exactAssetId)?.assetSymbols ?? [],
        });
      }

      const knownAsset = knownAssetsResult.value.get(exactAssetId);
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

    const knownAssetsResult = await this.loadKnownAssets();
    if (knownAssetsResult.isErr()) {
      return err(knownAssetsResult.error);
    }

    const matches = findAssetsBySymbol(knownAssetsResult.value.values(), symbol);
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
