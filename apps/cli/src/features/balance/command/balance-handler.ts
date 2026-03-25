import type { ExchangeCredentials } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion';

import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
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

  constructor(db: DataSession, balanceOperation: BalanceWorkflow | undefined) {
    const assetDetailsBuilder = new BalanceAssetDetailsBuilder(db);
    this.snapshotReader = new BalanceStoredSnapshotReader({
      db,
      balanceOperation,
      assetDetailsBuilder,
    });
    this.verificationRunner = new BalanceVerificationRunner({
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

  async loadAccountsForVerification(): Promise<Result<SortedVerificationAccount[], Error>> {
    return this.verificationRunner.loadAccountsForVerification();
  }

  async viewStoredSnapshots(params: {
    accountId?: number | undefined;
  }): Promise<Result<StoredSnapshotBalanceResult, Error>> {
    return this.snapshotReader.viewStoredSnapshots(params);
  }

  async refreshSingleScope(params: {
    accountId: number;
    credentials?: ExchangeCredentials | undefined;
  }): Promise<Result<SingleRefreshResult, Error>> {
    return this.verificationRunner.refreshSingleScope(params);
  }

  async refreshAllScopes(): Promise<Result<AllAccountsVerificationResult, Error>> {
    return this.verificationRunner.refreshAllScopes();
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
    if (!options.needsWorkflow) {
      return ok(new BalanceHandler(database, undefined));
    }

    const providerRuntimeResult = await ctx.openBlockchainProviderRuntime({ registerCleanup: false });
    if (providerRuntimeResult.isErr()) {
      return err(providerRuntimeResult.error);
    }
    const providerRuntime = providerRuntimeResult.value;
    const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const balancePorts = buildBalancePorts(database);
    const balanceWorkflow = new BalanceWorkflow(balancePorts, providerRuntime);
    const handler = new BalanceHandler(database, balanceWorkflow);
    ctx.onCleanup(async () => {
      await handler.awaitStream();
      await cleanupBlockchainProviderRuntime();
    });

    return ok(handler);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
