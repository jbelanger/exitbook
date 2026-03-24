import { type ProjectionId, type ProjectionStatus } from '@exitbook/core';
import {
  buildAssetReviewFreshnessPorts,
  buildProcessedTransactionsFreshnessPorts,
  buildLinksFreshnessPorts,
} from '@exitbook/data/projections';
import { EventBus } from '@exitbook/events';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { type IngestionEvent } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import type { CommandScope } from '../../runtime/command-scope.js';
import { createCliLinkingRuntime, readCliLinkOverrides } from '../../runtime/linking-runtime.js';
import { createCliProcessingWorkflowRuntime } from '../../runtime/processing-workflow-runtime.js';

import { createCliAssetReviewProjectionRuntime } from './asset-review-projection-runtime.js';
import { withCliBlockchainProviderRuntimeResult } from './blockchain-provider-runtime.js';
import { resetProjections } from './projection-reset.js';

const logger = getLogger('projection-readiness');

interface PrereqFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

type RebuildablePrereqId = Exclude<ProjectionId, 'balances'>;

export interface PrereqExecutionOptions {
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

async function rebuildIfStale(
  projectionId: RebuildablePrereqId,
  checkFreshness: () => Promise<Result<PrereqFreshnessResult, Error>>,
  rebuild: (freshness: PrereqFreshnessResult) => Promise<Result<void, Error>>
): Promise<Result<void, Error>> {
  const freshnessResult = await checkFreshness();
  if (freshnessResult.isErr()) {
    return err(freshnessResult.error);
  }

  if (freshnessResult.value.status === 'fresh') {
    return ok(undefined);
  }

  logger.info(
    { projectionId, status: freshnessResult.value.status, reason: freshnessResult.value.reason },
    'Projection is stale, rebuilding'
  );

  return rebuild(freshnessResult.value);
}

export async function ensureProcessedTransactionsReady(
  scope: CommandScope,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const db = await scope.database();
  const appRuntime = scope.requireAppRuntime();

  return rebuildIfStale(
    'processed-transactions',
    () => buildProcessedTransactionsFreshnessPorts(db).checkFreshness(),
    async (freshness) => {
      if (!options.isJsonMode) {
        console.log(`\nDerived data is stale (${freshness.reason ?? 'unknown'}), reprocessing...\n`);
      }

      return withCliBlockchainProviderRuntimeResult(
        { dataDir: scope.dataDir, explorerConfig: appRuntime.blockchainExplorersConfig },
        async (providerRuntime) => {
          const eventBus = new EventBus<IngestionEvent>({
            onError: (error) => {
              logger.error({ error }, 'EventBus error during reprocess');
            },
          });

          const { processingWorkflow } = createCliProcessingWorkflowRuntime({
            adapterRegistry: appRuntime.adapterRegistry,
            dataDir: scope.dataDir,
            database: db,
            eventBus,
            providerRuntime,
          });

          const planResult = await processingWorkflow.prepareReprocess({});
          if (planResult.isErr()) return err(planResult.error);

          if (!planResult.value) {
            logger.info('No raw data found to reprocess');
            return ok(undefined);
          }

          const { accountIds } = planResult.value;

          const resetResult = await resetProjections(db, 'processed-transactions', accountIds);
          if (resetResult.isErr()) return err(resetResult.error);

          const processResult = await processingWorkflow.processImportedSessions(accountIds);
          if (processResult.isErr()) return err(processResult.error);

          logger.info({ processed: processResult.value.processed }, 'Reprocess complete');

          if (processResult.value.errors.length > 0) {
            logger.warn({ errors: processResult.value.errors.slice(0, 5) }, 'Processing had errors');
          }

          return ok(undefined);
        }
      );
    }
  );
}

export async function ensureAssetReviewReady(scope: CommandScope): Promise<Result<void, Error>> {
  const db = await scope.database();

  return rebuildIfStale(
    'asset-review',
    () => buildAssetReviewFreshnessPorts(db).checkFreshness(),
    async () => createCliAssetReviewProjectionRuntime(db, scope.dataDir).rebuild()
  );
}

export async function ensureLinksReady(
  scope: CommandScope,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const db = await scope.database();

  return rebuildIfStale(
    'links',
    () => buildLinksFreshnessPorts(db).checkFreshness(),
    async () => {
      const params = {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const linkingRuntimeResult = createCliLinkingRuntime({
        dataDir: scope.dataDir,
        database: db,
        isJsonMode: options.isJsonMode,
      });
      if (linkingRuntimeResult.isErr()) {
        return err(linkingRuntimeResult.error);
      }

      const linkingRuntime = linkingRuntimeResult.value;
      const overridesResult = await readCliLinkOverrides(linkingRuntime.overrideStore);
      if (overridesResult.isErr()) {
        return err(overridesResult.error);
      }

      if (options.isJsonMode) {
        const result = await linkingRuntime.orchestrator.execute(params, overridesResult.value);
        if (result.isErr()) return err(result.error);
        logger.info('Linking completed (JSON mode)');
        return ok(undefined);
      }

      console.log('\nTransaction links are stale, running linking...\n');
      const controller = linkingRuntime.controller;
      if (!controller) {
        return err(new Error('Links controller was not created for interactive linking'));
      }
      const abort = () => {
        controller.abort();
        void controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop links controller on abort');
        });
      };

      options.setAbort?.(abort);
      try {
        await controller.start();

        const result = await linkingRuntime.orchestrator.execute(params, overridesResult.value);

        if (result.isErr()) {
          controller.fail(result.error.message);
          return err(result.error);
        }

        controller.complete();
        return ok(undefined);
      } catch (error) {
        const caughtError = error instanceof Error ? error : new Error(String(error));
        controller.fail(caughtError.message);
        return err(caughtError);
      } finally {
        options.setAbort?.(undefined);
        await controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop links controller during cleanup');
        });
      }
    }
  );
}
