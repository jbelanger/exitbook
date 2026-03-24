import type { Account, BalanceSnapshot } from '@exitbook/core';
import { buildBalancesFreshnessPorts, resolveBalanceScopeAccountId } from '@exitbook/data/balances';
import type { DataContext } from '@exitbook/data/context';
import { err, ok, type Result } from '@exitbook/foundation';
import type { BalanceWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import {
  BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
  formatBalanceSnapshotFreshnessMessage,
} from '../../shared/balance-snapshot-freshness-message.js';

import { BalanceAssetDetailsBuilder } from './balance-asset-details-builder.js';
import type { StoredSnapshotBalanceResult } from './balance-handler-types.js';

const logger = getLogger('BalanceStoredSnapshotReader');

interface BalanceStoredSnapshotReaderDeps {
  assetDetailsBuilder: BalanceAssetDetailsBuilder;
  balanceOperation: BalanceWorkflow | undefined;
  db: DataContext;
}

export class BalanceStoredSnapshotReader {
  private readonly assetDetailsBuilder: BalanceAssetDetailsBuilder;
  private readonly balanceOperation: BalanceWorkflow | undefined;
  private readonly db: DataContext;

  constructor(deps: BalanceStoredSnapshotReaderDeps) {
    this.assetDetailsBuilder = deps.assetDetailsBuilder;
    this.balanceOperation = deps.balanceOperation;
    this.db = deps.db;
  }

  async viewStoredSnapshots(params: {
    accountId?: number | undefined;
  }): Promise<Result<StoredSnapshotBalanceResult, Error>> {
    try {
      const accounts = params.accountId ? await this.loadSingleAccount(params.accountId) : await this.loadAllAccounts();

      const results = [];
      for (const requestedAccount of accounts) {
        const scopeAccount = await this.resolveStoredSnapshotScopeAccount(requestedAccount);
        const readabilityResult = await this.ensureStoredSnapshotReadable(requestedAccount, scopeAccount);
        if (readabilityResult.isErr()) {
          return err(readabilityResult.error);
        }

        const snapshotResult = await this.loadStoredSnapshotOrFail(scopeAccount.id);
        if (snapshotResult.isErr()) {
          return err(snapshotResult.error);
        }

        const assetsResult = await this.assetDetailsBuilder.buildStoredSnapshotAssets(scopeAccount);
        if (assetsResult.isErr()) {
          return err(assetsResult.error);
        }

        results.push({
          account: scopeAccount,
          assets: assetsResult.value,
          snapshot: snapshotResult.value,
          requestedAccount: requestedAccount.id === scopeAccount.id ? undefined : requestedAccount,
        });
      }

      return ok({ accounts: results });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async resolveStoredSnapshotScopeAccount(account: Account): Promise<Account> {
    const scopeAccountIdResult = await resolveBalanceScopeAccountId(this.db, account.id);
    if (scopeAccountIdResult.isErr()) {
      throw scopeAccountIdResult.error;
    }

    const scopeAccountId = scopeAccountIdResult.value;
    if (scopeAccountId === account.id) {
      return account;
    }

    const scopeAccountResult = await this.db.accounts.findById(scopeAccountId);
    if (scopeAccountResult.isErr()) {
      throw scopeAccountResult.error;
    }
    if (!scopeAccountResult.value) {
      throw new Error(`Balance scope account #${scopeAccountId} not found`);
    }

    return scopeAccountResult.value;
  }

  private async ensureStoredSnapshotReadable(
    requestedAccount: Account,
    scopeAccount: Account
  ): Promise<Result<void, Error>> {
    const freshnessResult = await this.checkStoredSnapshotFreshness(scopeAccount.id);
    if (freshnessResult.isErr()) {
      return err(freshnessResult.error);
    }

    if (freshnessResult.value.status === 'fresh') {
      return ok(undefined);
    }

    const hasStoredSnapshotResult = await this.hasStoredSnapshot(scopeAccount.id);
    if (hasStoredSnapshotResult.isErr()) {
      return err(hasStoredSnapshotResult.error);
    }

    if (
      !hasStoredSnapshotResult.value &&
      this.balanceOperation !== undefined &&
      freshnessResult.value.status !== 'building'
    ) {
      logger.info(
        {
          requestedAccountId: requestedAccount.id,
          scopeAccountId: scopeAccount.id,
          sourceName: scopeAccount.sourceName,
          freshnessReason: freshnessResult.value.reason,
          freshnessStatus: freshnessResult.value.status,
        },
        'Stored balance snapshot is missing; rebuilding calculated snapshot automatically'
      );

      const rebuildResult = await this.balanceOperation.rebuildCalculatedSnapshot({
        accountId: requestedAccount.id,
      });
      if (rebuildResult.isErr()) {
        return err(rebuildResult.error);
      }

      const refreshedResult = await this.checkStoredSnapshotFreshness(scopeAccount.id);
      if (refreshedResult.isErr()) {
        return err(refreshedResult.error);
      }
      if (refreshedResult.value.status === 'fresh') {
        return ok(undefined);
      }

      return err(
        new Error(
          formatBalanceSnapshotFreshnessMessage({
            requestedAccountId: requestedAccount.id,
            scopeAccountId: scopeAccount.id,
            scopeSourceName: scopeAccount.sourceName,
            status: refreshedResult.value.status,
            reason: refreshedResult.value.reason,
          })
        )
      );
    }

    if (!hasStoredSnapshotResult.value) {
      return err(
        new Error(
          formatBalanceSnapshotFreshnessMessage({
            requestedAccountId: requestedAccount.id,
            scopeAccountId: scopeAccount.id,
            scopeSourceName: scopeAccount.sourceName,
            status: freshnessResult.value.status,
            reason: BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
          })
        )
      );
    }

    return err(
      new Error(
        formatBalanceSnapshotFreshnessMessage({
          requestedAccountId: requestedAccount.id,
          scopeAccountId: scopeAccount.id,
          scopeSourceName: scopeAccount.sourceName,
          status: freshnessResult.value.status,
          reason: freshnessResult.value.reason,
        })
      )
    );
  }

  private async checkStoredSnapshotFreshness(
    scopeAccountId: number
  ): Promise<Result<{ reason: string | undefined; status: 'fresh' | 'stale' | 'building' | 'failed' }, Error>> {
    return buildBalancesFreshnessPorts(this.db).checkFreshness(scopeAccountId);
  }

  private async hasStoredSnapshot(scopeAccountId: number): Promise<Result<boolean, Error>> {
    const snapshotResult = await this.db.balanceSnapshots.findSnapshot(scopeAccountId);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    return ok(snapshotResult.value !== undefined);
  }

  private async loadStoredSnapshotOrFail(scopeAccountId: number): Promise<Result<BalanceSnapshot, Error>> {
    const snapshotResult = await this.db.balanceSnapshots.findSnapshot(scopeAccountId);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    if (!snapshotResult.value) {
      return err(new Error(`Stored balance snapshot for scope account #${scopeAccountId} was not found`));
    }

    return ok(snapshotResult.value);
  }

  private async loadAllAccounts(): Promise<Account[]> {
    const result = await this.db.accounts.findAll();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value.filter((account) => !account.parentAccountId);
  }

  private async loadSingleAccount(accountId: number): Promise<Account[]> {
    const result = await this.db.accounts.findById(accountId);
    if (result.isErr()) {
      throw result.error;
    }
    if (!result.value) {
      throw new Error(`Account #${accountId} not found`);
    }
    return [result.value];
  }
}
