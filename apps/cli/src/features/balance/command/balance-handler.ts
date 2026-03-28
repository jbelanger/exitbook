import type { AccountLifecycleService } from '@exitbook/accounts';
import type { ExchangeCredentials } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import type { Result } from '@exitbook/foundation';
import type { BalanceWorkflow } from '@exitbook/ingestion/balance';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import type { BalanceEvent } from '../view/balance-view-state.js';

import { BalanceAssetDetailsBuilder } from './balance-asset-details-builder.js';
import type {
  AllAccountsVerificationResult,
  SingleRefreshResult,
  SortedVerificationAccount,
  StoredSnapshotBalanceResult,
} from './balance-handler-types.js';
import { BalanceStoredSnapshotReader } from './balance-stored-snapshot-reader.js';
import { BalanceVerificationRunner } from './balance-verification-runner.js';

export class BalanceHandler {
  private readonly snapshotReader: BalanceStoredSnapshotReader;
  private readonly verificationRunner: BalanceVerificationRunner;

  constructor(
    db: DataSession,
    balanceOperation: BalanceWorkflow | undefined,
    accountService: Pick<AccountLifecycleService, 'listTopLevel' | 'requireOwned'>
  ) {
    const assetDetailsBuilder = new BalanceAssetDetailsBuilder(db);
    this.snapshotReader = new BalanceStoredSnapshotReader({
      accountService,
      db,
      balanceOperation,
      assetDetailsBuilder,
    });
    this.verificationRunner = new BalanceVerificationRunner({
      accountService,
      balanceOperation,
      assetDetailsBuilder,
    });
  }

  abort(): void {
    this.verificationRunner.abort();
  }

  async awaitStream(): Promise<void> {
    await this.verificationRunner.awaitStream();
  }

  async loadAccountsForVerification(profileId: number): Promise<Result<SortedVerificationAccount[], Error>> {
    return this.verificationRunner.loadAccountsForVerification(profileId);
  }

  async viewStoredSnapshots(params: {
    accountId?: number | undefined;
    profileId: number;
  }): Promise<Result<StoredSnapshotBalanceResult, Error>> {
    return this.snapshotReader.viewStoredSnapshots(params);
  }

  async refreshSingleScope(params: {
    accountId: number;
    credentials?: ExchangeCredentials | undefined;
    profileId: number;
  }): Promise<Result<SingleRefreshResult, Error>> {
    return this.verificationRunner.refreshSingleScope(params);
  }

  async refreshAllScopes(profileId: number): Promise<Result<AllAccountsVerificationResult, Error>> {
    return this.verificationRunner.refreshAllScopes(profileId);
  }

  startStream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): void {
    this.verificationRunner.startStream(accounts, relay);
  }
}
