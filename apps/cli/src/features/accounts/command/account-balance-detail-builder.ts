import type { Account, BalanceSnapshotAsset, Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, wrapError, type Result } from '@exitbook/foundation';
import type { BalanceVerificationResult } from '@exitbook/ingestion/balance';
import { loadAccountScopeMemberAccounts } from '@exitbook/ingestion/ports';

import {
  buildStoredBalanceAssetDiagnostics,
  buildStoredBalanceAssetViewItem,
} from '../stored-balance/stored-balance-detail-utils.js';
import { buildStoredBalanceAssetDiagnosticsSummary } from '../stored-balance/stored-balance-diagnostics.js';
import type { StoredBalanceAssetViewItem } from '../stored-balance/stored-balance-view.js';

import type { AssetComparisonItem } from './accounts-refresh-types.js';
import { sortAssetComparisonsByStatus } from './accounts-refresh-utils.js';

export class AccountBalanceDetailBuilder {
  constructor(private readonly db: DataSession) {}

  async buildStoredSnapshotAssets(scopeAccount: Account): Promise<Result<StoredBalanceAssetViewItem[], Error>> {
    const snapshotAssetsResult = await this.loadStoredSnapshotAssets(scopeAccount.id);
    if (snapshotAssetsResult.isErr()) {
      return err(snapshotAssetsResult.error);
    }

    const snapshotAssets = snapshotAssetsResult.value;
    if (snapshotAssets.length === 0) {
      return ok([]);
    }

    const transactionsResult = await this.loadAccountTransactions(scopeAccount);
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    return ok(
      snapshotAssets.map((asset) => {
        const diagnostics = this.buildDiagnosticsForAsset(asset.assetId, asset.assetSymbol, transactionsResult.value);
        return buildStoredBalanceAssetViewItem(
          asset.assetId,
          asset.assetSymbol,
          parseDecimal(asset.calculatedBalance),
          diagnostics,
          {
            liveBalance: asset.liveBalance,
            comparisonStatus: asset.comparisonStatus,
          }
        );
      })
    );
  }

  async buildComparisonItems(
    account: Account,
    verificationResult: BalanceVerificationResult
  ): Promise<Result<AssetComparisonItem[], Error>> {
    const transactionsResult = await this.loadAccountTransactions(account);
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    try {
      return ok(
        verificationResult.comparisons.map((comparison) => {
          const diagnostics = this.buildDiagnosticsForAsset(
            comparison.assetId,
            comparison.assetSymbol,
            transactionsResult.value,
            {
              liveBalance: comparison.liveBalance,
              calculatedBalance: comparison.calculatedBalance,
            }
          );

          return {
            assetId: comparison.assetId,
            assetSymbol: comparison.assetSymbol,
            calculatedBalance: comparison.calculatedBalance,
            liveBalance: comparison.liveBalance,
            difference: comparison.difference,
            percentageDiff: comparison.percentageDiff,
            status: comparison.status,
            diagnostics,
          };
        })
      );
    } catch (error) {
      return wrapError(error, `Failed to build balance diagnostics for account #${account.id}`);
    }
  }

  async buildSortedComparisonItems(
    account: Account,
    verificationResult: BalanceVerificationResult
  ): Promise<Result<AssetComparisonItem[], Error>> {
    const comparisonsResult = await this.buildComparisonItems(account, verificationResult);
    if (comparisonsResult.isErr()) {
      return err(comparisonsResult.error);
    }

    return ok(sortAssetComparisonsByStatus(comparisonsResult.value));
  }

  private async loadAccountTransactions(account: Account): Promise<Result<Transaction[], Error>> {
    const memberAccountsResult = await loadAccountScopeMemberAccounts(account, {
      findChildAccounts: async (parentAccountId: number) => {
        const childAccountsResult = await this.db.accounts.findAll({
          parentAccountId,
          profileId: account.profileId,
        });
        if (childAccountsResult.isErr()) {
          return err(childAccountsResult.error);
        }

        return ok(childAccountsResult.value);
      },
    });
    if (memberAccountsResult.isErr()) {
      return err(
        new Error(
          `Failed to load descendant accounts for diagnostics for account #${account.id}: ${memberAccountsResult.error.message}`
        )
      );
    }

    const txResult = await this.db.transactions.findAll({
      accountIds: memberAccountsResult.value.map((memberAccount) => memberAccount.id),
    });
    if (txResult.isErr()) {
      return err(
        new Error(`Failed to load transactions for diagnostics for account #${account.id}: ${txResult.error.message}`)
      );
    }
    return ok(txResult.value);
  }

  private buildDiagnosticsForAsset(
    assetId: string,
    assetSymbol: string,
    transactions: Transaction[],
    balances?: { calculatedBalance: string; liveBalance: string }
  ) {
    const diagnosticsSummary = buildStoredBalanceAssetDiagnosticsSummary({ assetId, assetSymbol, transactions });
    return buildStoredBalanceAssetDiagnostics(diagnosticsSummary, balances);
  }

  private async loadStoredSnapshotAssets(scopeAccountId: number): Promise<Result<BalanceSnapshotAsset[], Error>> {
    const assetsResult = await this.db.balanceSnapshots.findAssetsByScope([scopeAccountId]);
    if (assetsResult.isErr()) {
      return err(
        new Error(
          `Failed to load stored balance snapshot assets for account #${scopeAccountId}: ${assetsResult.error.message}`
        )
      );
    }

    return ok(assetsResult.value);
  }
}
