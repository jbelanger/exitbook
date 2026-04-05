import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Account } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';
import { getLogger } from '@exitbook/logger';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import { formatAccountSelectorLabel } from '../account-selector.js';

import { AccountBalanceDetailBuilder } from './account-balance-detail-builder.js';
import type {
  AccountsRefreshEvent,
  AllAccountsRefreshResult,
  SingleRefreshResult,
  SortedRefreshAccount,
} from './accounts-refresh-types.js';
import { resolveAccountRefreshCredentials, sortAccountsByRefreshPriority } from './accounts-refresh-utils.js';

const logger = getLogger('AccountsRefreshRunner');

function buildStoredCredentialMissingError(account: Account, reason: string): Error {
  return new Error(
    `Account ${formatAccountSelectorLabel(account)} has ${reason}. Store provider credentials on the account before refreshing live balances.`
  );
}

interface AccountsRefreshRunnerDeps {
  accountService: Pick<AccountLifecycleService, 'listTopLevel' | 'requireOwned'>;
  detailBuilder: AccountBalanceDetailBuilder;
  balanceWorkflow: BalanceWorkflow | undefined;
}

export class AccountsRefreshRunner {
  private abortController: AbortController | undefined;
  private readonly accountService: Pick<AccountLifecycleService, 'listTopLevel' | 'requireOwned'>;
  private readonly detailBuilder: AccountBalanceDetailBuilder;
  private readonly balanceWorkflow: BalanceWorkflow | undefined;
  private streamPromise: Promise<'aborted' | 'completed'> | undefined;

  constructor(deps: AccountsRefreshRunnerDeps) {
    this.accountService = deps.accountService;
    this.detailBuilder = deps.detailBuilder;
    this.balanceWorkflow = deps.balanceWorkflow;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async awaitStream(): Promise<'aborted' | 'completed'> {
    if (!this.streamPromise) {
      return 'completed';
    }

    return await this.streamPromise;
  }

  async loadAccountsForRefresh(profileId: number): Promise<Result<SortedRefreshAccount[], Error>> {
    const result = await this.accountService.listTopLevel(profileId);
    if (result.isErr()) return err(result.error);

    const sorted = sortAccountsByRefreshPriority(
      result.value.map((account) => ({
        accountId: account.id,
        platformKey: account.platformKey,
        accountType: account.accountType,
        account,
      }))
    );

    return ok(
      sorted.map((item) => {
        const { skipReason } = resolveAccountRefreshCredentials(item.account);
        return {
          account: item.account,
          accountId: item.accountId,
          platformKey: item.platformKey,
          accountType: item.accountType,
          skipReason,
        };
      })
    );
  }

  async refreshSingleScope(params: {
    accountId: number;
    profileId: number;
  }): Promise<Result<SingleRefreshResult, Error>> {
    const workflow = this.requireBalanceWorkflow();

    try {
      const requestedAccount = await this.loadSingleAccountOrFail(params.profileId, params.accountId);
      const { credentials, skipReason } = resolveAccountRefreshCredentials(requestedAccount);

      if (skipReason) {
        return err(buildStoredCredentialMissingError(requestedAccount, skipReason));
      }

      const result = await workflow.refreshVerification({
        accountId: requestedAccount.id,
        credentials,
      });
      if (result.isErr()) return err(result.error);

      const verificationResult = result.value;
      const scopeAccount = verificationResult.account;

      if (verificationResult.mode === 'calculated-only') {
        const snapshotAssetsResult = await this.detailBuilder.buildStoredSnapshotAssets(scopeAccount);
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

      const comparisonsResult = await this.detailBuilder.buildComparisonItems(scopeAccount, verificationResult);
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

  async refreshAllScopes(profileId: number): Promise<Result<AllAccountsRefreshResult, Error>> {
    const workflow = this.requireBalanceWorkflow();

    try {
      const accounts = await this.loadAllAccounts(profileId);
      const sorted = sortAccountsByRefreshPriority(
        accounts.map((account) => ({
          accountId: account.id,
          platformKey: account.platformKey,
          accountType: account.accountType,
          account,
        }))
      );

      const accountResults = [];
      let errors = 0;
      let verified = 0;
      let skipped = 0;
      let matchTotal = 0;
      let mismatchTotal = 0;
      let partialCoverageScopeTotal = 0;
      let warningTotal = 0;

      for (const item of sorted) {
        const account = item.account;
        const { credentials, skipReason } = resolveAccountRefreshCredentials(account);

        if (skipReason) {
          skipped++;
          accountResults.push({
            accountId: account.id,
            platformKey: account.platformKey,
            accountType: account.accountType,
            status: 'skipped',
            reason: skipReason,
          });
          continue;
        }

        const result = await workflow.refreshVerification({ accountId: account.id, credentials });
        if (result.isErr()) {
          errors++;
          accountResults.push({
            accountId: account.id,
            platformKey: account.platformKey,
            accountType: account.accountType,
            status: 'error',
            error: result.error.message,
          });
          continue;
        }

        const verificationResult = result.value;
        matchTotal += verificationResult.summary.matches;
        mismatchTotal += verificationResult.summary.mismatches;
        warningTotal += Math.max(
          verificationResult.summary.warnings,
          verificationResult.warnings?.length ?? 0,
          verificationResult.status === 'warning' ? 1 : 0
        );
        partialCoverageScopeTotal += verificationResult.coverage.status === 'partial' ? 1 : 0;

        let comparisons;
        if (verificationResult.mode !== 'calculated-only') {
          const comparisonsResult = await this.detailBuilder.buildComparisonItems(
            verificationResult.account,
            verificationResult
          );
          if (comparisonsResult.isErr()) {
            errors++;
            accountResults.push({
              accountId: account.id,
              platformKey: account.platformKey,
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
          platformKey: account.platformKey,
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
          errors,
          total: accounts.length,
          verified,
          skipped,
          matches: matchTotal,
          mismatches: mismatchTotal,
          warnings: warningTotal,
          partialCoverageScopes: partialCoverageScopeTotal,
        },
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  startStream(accounts: SortedRefreshAccount[], relay: EventRelay<AccountsRefreshEvent>): void {
    this.streamPromise = this.runStream(accounts, relay)
      .then(() => 'completed' as const)
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return 'aborted' as const;
        }

        logger.error({ error }, 'Refresh loop error');
        throw error;
      });
  }

  private async runStream(accounts: SortedRefreshAccount[], relay: EventRelay<AccountsRefreshEvent>): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const workflow = this.requireBalanceWorkflow();
    let abortNotified = false;

    const throwIfAborted = () => {
      if (!signal.aborted) {
        return;
      }

      if (!abortNotified) {
        relay.push({ type: 'ABORTING' });
        abortNotified = true;
      }

      const error = new Error('Verification aborted');
      error.name = 'AbortError';
      throw error;
    };

    for (const item of accounts) {
      throwIfAborted();

      if (item.skipReason) {
        continue;
      }

      const { credentials } = resolveAccountRefreshCredentials(item.account);
      relay.push({ type: 'VERIFICATION_STARTED', accountId: item.accountId });

      try {
        const result = await workflow.refreshVerification({ accountId: item.accountId, credentials });

        if (result.isErr()) {
          relay.push({ type: 'VERIFICATION_ERROR', accountId: item.accountId, error: result.error.message });
          continue;
        }

        throwIfAborted();

        const verificationResult = result.value;
        let verificationItem;

        if (verificationResult.mode === 'calculated-only') {
          const storedSnapshotAssetsResult = await this.detailBuilder.buildStoredSnapshotAssets(
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
            platformKey: item.platformKey,
            accountType: item.accountType,
            status: 'warning' as const,
            assetCount: storedSnapshotAssetsResult.value.length,
            matchCount: 0,
            mismatchCount: 0,
            warningCount: Math.max(
              verificationResult.summary.warnings,
              verificationResult.warnings?.length ?? 0,
              verificationResult.status === 'warning' ? 1 : 0
            ),
            partialCoverageCount: verificationResult.coverage.status === 'partial' ? 1 : 0,
            warnings: verificationResult.warnings,
            comparisons: undefined,
          };
        } else {
          const comparisonsResult = await this.detailBuilder.buildSortedComparisonItems(
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

          throwIfAborted();

          const comparisons = comparisonsResult.value;
          verificationItem = {
            accountId: item.accountId,
            platformKey: item.platformKey,
            accountType: item.accountType,
            status: verificationResult.status,
            assetCount: comparisons.length,
            matchCount: comparisons.filter((comparison) => comparison.status === 'match').length,
            mismatchCount: comparisons.filter((comparison) => comparison.status === 'mismatch').length,
            warningCount: comparisons.filter((comparison) => comparison.status === 'warning').length,
            partialCoverageCount: verificationResult.coverage.status === 'partial' ? 1 : 0,
            warnings: verificationResult.warnings,
            comparisons,
          };
        }

        relay.push({ type: 'VERIFICATION_COMPLETED', accountId: item.accountId, result: verificationItem });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throwIfAborted();
        }

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
    if (!this.balanceWorkflow) throw new Error('BalanceWorkflow not available in refresh mode');
    return this.balanceWorkflow;
  }

  private async loadAllAccounts(profileId: number): Promise<Account[]> {
    const result = await this.accountService.listTopLevel(profileId);
    if (result.isErr()) throw result.error;
    return result.value;
  }

  private async loadSingleAccountOrFail(profileId: number, accountId: number): Promise<Account> {
    const result = await this.accountService.requireOwned(profileId, accountId);
    if (result.isErr()) throw result.error;
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
