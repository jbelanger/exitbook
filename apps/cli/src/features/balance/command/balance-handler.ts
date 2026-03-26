import type { AccountLifecycleService } from '@exitbook/accounts';
import type { ExchangeCredentials } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion';

import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import type { EventRelay } from '../../../ui/shared/event-relay.js';
import { buildCliAccountLifecycleService } from '../../accounts/account-service.js';
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
      db,
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

export async function createBalanceHandler(
  ctx: CommandRuntime,
  options: { needsWorkflow: boolean }
): Promise<Result<BalanceHandler, Error>> {
  try {
    const database = await ctx.database();
    const accountService = buildCliAccountLifecycleService(database);
    if (!options.needsWorkflow) {
      return ok(new BalanceHandler(database, undefined, accountService));
    }

    const providerRuntimeResult = await ctx.openBlockchainProviderRuntime({ registerCleanup: false });
    if (providerRuntimeResult.isErr()) {
      return err(providerRuntimeResult.error);
    }
    const providerRuntime = providerRuntimeResult.value;
    const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const balancePorts = buildBalancePorts(database);
    const balanceWorkflow = new BalanceWorkflow(balancePorts, providerRuntime);
    const handler = new BalanceHandler(database, balanceWorkflow, accountService);
    ctx.onCleanup(async () => {
      await handler.awaitStream();
      await cleanupBlockchainProviderRuntime();
    });

    return ok(handler);
  } catch (error) {
    return wrapError(error, 'Failed to create balance handler');
  }
}
