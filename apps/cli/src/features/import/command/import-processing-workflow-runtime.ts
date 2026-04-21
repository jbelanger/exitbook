import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { buildProcessingPorts } from '@exitbook/data/ingestion';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import { ProcessingWorkflow } from '@exitbook/ingestion/process';
import { createSeedProtocolCatalog } from '@exitbook/protocol-catalog';
import {
  AssetMigrationParticipantDetector,
  BridgeParticipantDetector,
  HeuristicBridgeParticipantDetector,
  InterpretationRuntime,
  StakingRewardDetector,
  TransactionAnnotationDetectorRegistry,
  TransactionAnnotationProfileDetectorRegistry,
} from '@exitbook/transaction-interpretation';

import type { CliAdapterRegistryFactory } from '../../../runtime/app-runtime.js';
import type { CliAssetReviewProjectionFactory } from '../../../runtime/command-capability-factories.js';

interface CliProcessingWorkflowRuntime {
  processingWorkflow: ProcessingWorkflow;
}

interface CreateCliProcessingWorkflowRuntimeOptions {
  adapterRegistryFactory: CliAdapterRegistryFactory;
  assetReviewProjectionFactory: CliAssetReviewProjectionFactory;
  dataDir: string;
  database: DataSession;
  eventBus: EventBus<IngestionEvent>;
  providerRuntime: IBlockchainProviderRuntime;
}

export async function rebuildCliAssetReviewProjectionsForAccounts(
  database: DataSession,
  accountIds: number[],
  assetReviewProjectionFactory: CliAssetReviewProjectionFactory
): Promise<import('@exitbook/foundation').Result<void, Error>> {
  if (accountIds.length === 0) {
    return ok(undefined);
  }

  const profilesResult = await database.profiles.list();
  if (profilesResult.isErr()) {
    return err(profilesResult.error);
  }

  const profilesById = new Map(profilesResult.value.map((profile) => [profile.id, profile]));
  const scopedProfiles = new Map<number, { profileId: number; profileKey: string }>();

  for (const accountId of [...new Set(accountIds)]) {
    const accountResult = await database.accounts.getById(accountId);
    if (accountResult.isErr()) {
      return err(
        new Error(`Failed to resolve account ${accountId} for asset review rebuild: ${accountResult.error.message}`)
      );
    }

    const profileId = accountResult.value.profileId;
    if (profileId === undefined) {
      return err(new Error(`Profile not set for account ${accountId} during asset review rebuild`));
    }

    const profile = profilesById.get(profileId);
    if (!profile) {
      return err(new Error(`Profile ${String(profileId)} not found for account ${accountId}`));
    }

    scopedProfiles.set(profile.id, {
      profileId: profile.id,
      profileKey: profile.profileKey,
    });
  }

  for (const profile of scopedProfiles.values()) {
    const assetReviewRuntimeResult = assetReviewProjectionFactory.createForProfile({
      profileId: profile.profileId,
      profileKey: profile.profileKey,
    });
    if (assetReviewRuntimeResult.isErr()) {
      return err(assetReviewRuntimeResult.error);
    }

    const rebuildResult = await assetReviewRuntimeResult.value.rebuild();
    if (rebuildResult.isErr()) {
      return err(
        new Error(`Failed to rebuild asset review for profile ${profile.profileKey}: ${rebuildResult.error.message}`)
      );
    }
  }

  return ok(undefined);
}

async function resolveScopedProfilesForAccounts(
  database: DataSession,
  accountIds: number[]
): Promise<Result<{ profileId: number; profileKey: string }[], Error>> {
  if (accountIds.length === 0) {
    return ok([]);
  }

  const profilesResult = await database.profiles.list();
  if (profilesResult.isErr()) {
    return err(profilesResult.error);
  }

  const profilesById = new Map(profilesResult.value.map((profile) => [profile.id, profile]));
  const scopedProfiles = new Map<number, { profileId: number; profileKey: string }>();

  for (const accountId of [...new Set(accountIds)]) {
    const accountResult = await database.accounts.getById(accountId);
    if (accountResult.isErr()) {
      return err(new Error(`Failed to resolve account ${accountId}: ${accountResult.error.message}`));
    }

    const profileId = accountResult.value.profileId;
    if (profileId === undefined) {
      return err(new Error(`Profile not set for account ${accountId}`));
    }

    const profile = profilesById.get(profileId);
    if (!profile) {
      return err(new Error(`Profile ${String(profileId)} not found for account ${accountId}`));
    }

    scopedProfiles.set(profile.id, {
      profileId: profile.id,
      profileKey: profile.profileKey,
    });
  }

  return ok([...scopedProfiles.values()]);
}

function createCliInterpretationRuntime(database: DataSession): InterpretationRuntime {
  const protocolCatalog = createSeedProtocolCatalog();
  const registry = new TransactionAnnotationDetectorRegistry();
  registry.register(new BridgeParticipantDetector(protocolCatalog));
  registry.register(new AssetMigrationParticipantDetector());
  registry.register(new StakingRewardDetector());

  const profileRegistry = new TransactionAnnotationProfileDetectorRegistry();
  profileRegistry.register(new HeuristicBridgeParticipantDetector());

  return new InterpretationRuntime({
    annotationStore: database.transactionAnnotations,
    registry,
    profileRegistry,
    sourceReader: database.transactionInterpretationSource,
  });
}

export async function rebuildCliTransactionInterpretationForAccounts(
  database: DataSession,
  accountIds: number[]
): Promise<import('@exitbook/foundation').Result<void, Error>> {
  if (accountIds.length === 0) {
    return ok(undefined);
  }

  const scopedProfilesResult = await resolveScopedProfilesForAccounts(database, accountIds);
  if (scopedProfilesResult.isErr()) {
    return err(scopedProfilesResult.error);
  }

  const runtime = createCliInterpretationRuntime(database);

  for (const profile of scopedProfilesResult.value) {
    const transactionsResult = await database.transactions.findAll({ profileId: profile.profileId });
    if (transactionsResult.isErr()) {
      return err(
        new Error(
          `Failed to load transactions for interpretation rebuild on profile ${profile.profileKey}: ${transactionsResult.error.message}`
        )
      );
    }

    for (const transaction of transactionsResult.value) {
      const bridgeResult = await runtime.runForTransaction({
        detectorId: 'bridge-participant',
        accountId: transaction.accountId,
        transactionId: transaction.id,
        txFingerprint: transaction.txFingerprint,
      });
      if (bridgeResult.isErr()) {
        return err(
          new Error(
            `Failed to rebuild bridge interpretation for transaction ${transaction.txFingerprint}: ${bridgeResult.error.message}`
          )
        );
      }

      const assetMigrationResult = await runtime.runForTransaction({
        detectorId: 'asset-migration-participant',
        accountId: transaction.accountId,
        transactionId: transaction.id,
        txFingerprint: transaction.txFingerprint,
      });
      if (assetMigrationResult.isErr()) {
        return err(
          new Error(
            `Failed to rebuild asset migration interpretation for transaction ${transaction.txFingerprint}: ${assetMigrationResult.error.message}`
          )
        );
      }

      const stakingRewardResult = await runtime.runForTransaction({
        detectorId: 'staking-reward',
        accountId: transaction.accountId,
        transactionId: transaction.id,
        txFingerprint: transaction.txFingerprint,
      });
      if (stakingRewardResult.isErr()) {
        return err(
          new Error(
            `Failed to rebuild staking reward interpretation for transaction ${transaction.txFingerprint}: ${stakingRewardResult.error.message}`
          )
        );
      }
    }

    const heuristicBridgeResult = await runtime.runForProfile({
      detectorId: 'heuristic-bridge-participant',
      profileId: profile.profileId,
    });
    if (heuristicBridgeResult.isErr()) {
      return err(
        new Error(
          `Failed to rebuild heuristic bridge interpretation for profile ${profile.profileKey}: ${heuristicBridgeResult.error.message}`
        )
      );
    }
  }

  return ok(undefined);
}

export function createCliProcessingWorkflowRuntime(
  options: CreateCliProcessingWorkflowRuntimeOptions
): Result<CliProcessingWorkflowRuntime, Error> {
  try {
    const overrideStore = new OverrideStore(options.dataDir);
    const ports = buildProcessingPorts(options.database, {
      rebuildTransactionInterpretation: (accountIds) =>
        rebuildCliTransactionInterpretationForAccounts(options.database, accountIds),
      rebuildAssetReviewProjection: (accountIds) =>
        rebuildCliAssetReviewProjectionsForAccounts(options.database, accountIds, options.assetReviewProjectionFactory),
      overrideStore,
    });
    const processingAdapterRegistry = options.adapterRegistryFactory({ nearBatchSource: ports.nearBatchSource });

    return ok({
      processingWorkflow: new ProcessingWorkflow(
        ports,
        options.providerRuntime,
        options.eventBus,
        processingAdapterRegistry
      ),
    });
  } catch (error) {
    return wrapError(error, 'Failed to create CLI processing workflow runtime');
  }
}
