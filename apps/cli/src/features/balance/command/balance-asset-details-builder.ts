import type { Account, BalanceSnapshotAsset, Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, wrapError, type Result } from '@exitbook/foundation';
import type { BalanceVerificationResult } from '@exitbook/ingestion/balance';
import { loadBalanceScopeMemberAccounts } from '@exitbook/ingestion/ports';
import { getLogger } from '@exitbook/logger';

import { buildBalanceAssetDiagnosticsSummary } from '../shared/balance-diagnostics.js';
import type { AssetComparisonItem, StoredSnapshotAssetItem } from '../view/balance-view-state.js';
import { buildAssetDiagnostics, buildStoredSnapshotAssetItem, sortAssetsByStatus } from '../view/balance-view-utils.js';

const logger = getLogger('BalanceAssetDetailsBuilder');

export class BalanceAssetDetailsBuilder {
  constructor(private readonly db: DataSession) {}

  async buildStoredSnapshotAssets(scopeAccount: Account): Promise<Result<StoredSnapshotAssetItem[], Error>> {
    const snapshotAssets = await this.loadStoredSnapshotAssets(scopeAccount.id);
    if (snapshotAssets.length === 0) {
      return ok([]);
    }

    const transactionsResult = await this.loadAccountTransactions(scopeAccount);
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    return ok(
      snapshotAssets.map((asset) => {
        const assetSymbol = asset.assetSymbol;
        const diagnostics = this.buildDiagnosticsForAsset(asset.assetId, assetSymbol, transactionsResult.value);
        return buildStoredSnapshotAssetItem(
          asset.assetId,
          assetSymbol,
          parseDecimal(asset.calculatedBalance),
          diagnostics
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

    return ok(sortAssetsByStatus(comparisonsResult.value));
  }

  private async loadAccountTransactions(account: Account): Promise<Result<Transaction[], Error>> {
    if (account.profileId === undefined) {
      return err(new Error(`Account #${account.id} is missing profile scope`));
    }

    const memberAccountsResult = await loadBalanceScopeMemberAccounts(account, {
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
  ): ReturnType<typeof buildAssetDiagnostics> {
    const diagnosticsSummary = buildBalanceAssetDiagnosticsSummary({ assetId, assetSymbol, transactions });
    return buildAssetDiagnostics(diagnosticsSummary, balances);
  }

  private async loadStoredSnapshotAssets(scopeAccountId: number): Promise<BalanceSnapshotAsset[]> {
    const assetsResult = await this.db.balanceSnapshots.findAssetsByScope([scopeAccountId]);
    if (assetsResult.isErr()) {
      logger.warn(
        { scopeAccountId, error: assetsResult.error },
        'Failed to load balance snapshot assets for balance view'
      );
      return [];
    }

    return assetsResult.value;
  }
}
