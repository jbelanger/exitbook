import type { Account, ExchangeCredentials } from '@exitbook/core';
import type { DataContext } from '@exitbook/data/context';
import { err, ok, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import type { BalanceEvent } from '../view/balance-view-state.js';
import { resolveAccountCredentials, sortAccountsByVerificationPriority } from '../view/balance-view-utils.js';

import { BalanceAssetDetailsBuilder } from './balance-asset-details-builder.js';
import type {
  AllAccountsVerificationResult,
  SingleRefreshResult,
  SortedVerificationAccount,
} from './balance-handler-types.js';

const logger = getLogger('BalanceVerificationRunner');

interface BalanceVerificationRunnerDeps {
  assetDetailsBuilder: BalanceAssetDetailsBuilder;
  balanceOperation: BalanceWorkflow | undefined;
  db: DataContext;
}

export class BalanceVerificationRunner {
  private abortController: AbortController | undefined;
  private readonly assetDetailsBuilder: BalanceAssetDetailsBuilder;
  private readonly balanceOperation: BalanceWorkflow | undefined;
  private readonly db: DataContext;
  private streamPromise: Promise<void> | undefined;

  constructor(deps: BalanceVerificationRunnerDeps) {
    this.assetDetailsBuilder = deps.assetDetailsBuilder;
    this.balanceOperation = deps.balanceOperation;
    this.db = deps.db;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async awaitStream(): Promise<void> {
    await this.streamPromise;
  }

  async loadAccountsForVerification(): Promise<Result<SortedVerificationAccount[], Error>> {
    const result = await this.db.accounts.findAll();
    if (result.isErr()) return err(result.error);

    const topLevel = result.value.filter((account) => !account.parentAccountId);
    const sorted = sortAccountsByVerificationPriority(
      topLevel.map((account) => ({
        accountId: account.id,
        sourceName: account.sourceName,
        accountType: account.accountType,
        account,
      }))
    );

    return ok(
      sorted.map((item) => {
        const { skipReason } = resolveAccountCredentials(item.account);
        return {
          account: item.account,
          accountId: item.accountId,
          sourceName: item.sourceName,
          accountType: item.accountType,
          skipReason,
        };
      })
    );
  }

  async refreshSingleScope(params: {
    accountId: number;
    credentials?: ExchangeCredentials | undefined;
  }): Promise<Result<SingleRefreshResult, Error>> {
    const operation = this.requireBalanceWorkflow();

    try {
      const requestedAccount = await this.loadSingleAccountOrFail(params.accountId);

      const result = await operation.refreshVerification({
        accountId: requestedAccount.id,
        credentials: params.credentials,
      });
      if (result.isErr()) return err(result.error);

      const verificationResult = result.value;
      const scopeAccount = verificationResult.account;

      if (verificationResult.mode === 'calculated-only') {
        const snapshotAssetsResult = await this.assetDetailsBuilder.buildStoredSnapshotAssets(scopeAccount);
        if (snapshotAssetsResult.isErr()) return err(snapshotAssetsResult.error);

        return ok({
          mode: 'calculated-only',
          account: scopeAccount,
          requestedAccount: requestedAccount.id === scopeAccount.id ? undefined : requestedAccount,
          assets: snapshotAssetsResult.value,
          verificationResult,
          streamMetadata: this.extractStreamMetadata(scopeAccount),
        });
      }

      const comparisonsResult = await this.assetDetailsBuilder.buildComparisonItems(scopeAccount, verificationResult);
      if (comparisonsResult.isErr()) return err(comparisonsResult.error);

      return ok({
        mode: 'verification',
        account: scopeAccount,
        requestedAccount: requestedAccount.id === scopeAccount.id ? undefined : requestedAccount,
        comparisons: comparisonsResult.value,
        verificationResult,
        streamMetadata: this.extractStreamMetadata(scopeAccount),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async refreshAllScopes(): Promise<Result<AllAccountsVerificationResult, Error>> {
    const operation = this.requireBalanceWorkflow();

    try {
      const accounts = await this.loadAllAccounts();
      const sorted = sortAccountsByVerificationPriority(
        accounts.map((account) => ({
          accountId: account.id,
          sourceName: account.sourceName,
          accountType: account.accountType,
          account,
        }))
      );

      const accountResults = [];
      let verified = 0;
      let skipped = 0;
      let matchTotal = 0;
      let mismatchTotal = 0;

      for (const item of sorted) {
        const account = item.account;
        const { credentials, skipReason } = resolveAccountCredentials(account);

        if (skipReason) {
          skipped++;
          accountResults.push({
            accountId: account.id,
            sourceName: account.sourceName,
            accountType: account.accountType,
            status: 'skipped',
            reason: skipReason,
          });
          continue;
        }

        const result = await operation.refreshVerification({ accountId: account.id, credentials });
        if (result.isErr()) {
          accountResults.push({
            accountId: account.id,
            sourceName: account.sourceName,
            accountType: account.accountType,
            status: 'error',
            error: result.error.message,
          });
          continue;
        }

        const verificationResult = result.value;
        matchTotal += verificationResult.summary.matches;
        mismatchTotal +=
          verificationResult.summary.mismatches +
          verificationResult.summary.warnings +
          (verificationResult.coverage.status === 'partial' ? 1 : 0);

        let comparisons;
        if (verificationResult.mode !== 'calculated-only') {
          const comparisonsResult = await this.assetDetailsBuilder.buildComparisonItems(
            verificationResult.account,
            verificationResult
          );
          if (comparisonsResult.isErr()) {
            accountResults.push({
              accountId: account.id,
              sourceName: account.sourceName,
              accountType: account.accountType,
              status: 'error',
              error: comparisonsResult.error.message,
            });
            continue;
          }

          comparisons = comparisonsResult.value;
        }

        verified++;
        accountResults.push({
          accountId: account.id,
          sourceName: account.sourceName,
          accountType: account.accountType,
          status: verificationResult.status,
          reason: verificationResult.mode === 'calculated-only' ? verificationResult.warnings?.[0] : undefined,
          summary: verificationResult.summary,
          coverage: verificationResult.coverage,
          partialFailures: verificationResult.partialFailures,
          warnings: verificationResult.warnings,
          comparisons,
        });
      }

      return ok({
        accounts: accountResults,
        totals: {
          total: accounts.length,
          verified,
          skipped,
          matches: matchTotal,
          mismatches: mismatchTotal,
        },
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  startStream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): void {
    this.streamPromise = this.runStream(accounts, relay).catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      logger.error({ error }, 'Verification loop error');
    });
  }

  private async runStream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const operation = this.requireBalanceWorkflow();

    for (const item of accounts) {
      if (signal.aborted) {
        const error = new Error('Verification aborted');
        error.name = 'AbortError';
        throw error;
      }

      if (item.skipReason) {
        continue;
      }

      const { credentials } = resolveAccountCredentials(item.account);
      relay.push({ type: 'VERIFICATION_STARTED', accountId: item.accountId });

      try {
        const result = await operation.refreshVerification({ accountId: item.accountId, credentials });

        if (result.isErr()) {
          relay.push({ type: 'VERIFICATION_ERROR', accountId: item.accountId, error: result.error.message });
          continue;
        }

        if (signal.aborted) {
          const error = new Error('Verification aborted');
          error.name = 'AbortError';
          throw error;
        }

        const verificationResult = result.value;
        let verificationItem;

        if (verificationResult.mode === 'calculated-only') {
          const storedSnapshotAssetsResult = await this.assetDetailsBuilder.buildStoredSnapshotAssets(
            verificationResult.account
          );
          if (storedSnapshotAssetsResult.isErr()) {
            relay.push({
              type: 'VERIFICATION_ERROR',
              accountId: item.accountId,
              error: storedSnapshotAssetsResult.error.message,
            });
            continue;
          }

          verificationItem = {
            accountId: item.accountId,
            sourceName: item.sourceName,
            accountType: item.accountType,
            status: 'warning' as const,
            assetCount: storedSnapshotAssetsResult.value.length,
            matchCount: 0,
            mismatchCount: 0,
            warningCount: Math.max(1, verificationResult.warnings?.length ?? 0),
            warnings: verificationResult.warnings,
            comparisons: undefined,
          };
        } else {
          const comparisonsResult = await this.assetDetailsBuilder.buildSortedComparisonItems(
            verificationResult.account,
            verificationResult
          );
          if (comparisonsResult.isErr()) {
            relay.push({
              type: 'VERIFICATION_ERROR',
              accountId: item.accountId,
              error: comparisonsResult.error.message,
            });
            continue;
          }

          if (signal.aborted) {
            const error = new Error('Verification aborted');
            error.name = 'AbortError';
            throw error;
          }

          const comparisons = comparisonsResult.value;
          verificationItem = {
            accountId: item.accountId,
            sourceName: item.sourceName,
            accountType: item.accountType,
            status: verificationResult.status,
            assetCount: comparisons.length,
            matchCount: comparisons.filter((comparison) => comparison.status === 'match').length,
            mismatchCount: comparisons.filter((comparison) => comparison.status === 'mismatch').length,
            warningCount:
              comparisons.filter((comparison) => comparison.status === 'warning').length +
              (verificationResult.coverage.status === 'partial' ? 1 : 0),
            warnings: verificationResult.warnings,
            comparisons,
          };
        }

        relay.push({ type: 'VERIFICATION_COMPLETED', accountId: item.accountId, result: verificationItem });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        relay.push({
          type: 'VERIFICATION_ERROR',
          accountId: item.accountId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    relay.push({ type: 'ALL_VERIFICATIONS_COMPLETE' });
  }

  private requireBalanceWorkflow(): BalanceWorkflow {
    if (!this.balanceOperation) throw new Error('BalanceWorkflow not available in balance view mode');
    return this.balanceOperation;
  }

  private async loadAllAccounts(): Promise<Account[]> {
    const result = await this.db.accounts.findAll();
    if (result.isErr()) throw result.error;
    return result.value.filter((account) => !account.parentAccountId);
  }

  private async loadSingleAccountOrFail(accountId: number): Promise<Account> {
    const result = await this.db.accounts.findById(accountId);
    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error(`Account #${accountId} not found`);
    return result.value;
  }

  private extractStreamMetadata(account: Account): Record<string, unknown> | undefined {
    if (!account.lastCursor || Object.keys(account.lastCursor).length === 0) {
      return undefined;
    }

    const streamMetadata: Record<string, { metadata?: unknown; totalFetched: number }> = {};
    for (const [streamType, cursor] of Object.entries(account.lastCursor)) {
      streamMetadata[streamType] = {
        totalFetched: cursor.totalFetched,
        ...(cursor.metadata && { metadata: cursor.metadata }),
      };
    }
    return streamMetadata;
  }
}
