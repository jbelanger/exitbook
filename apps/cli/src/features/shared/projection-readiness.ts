import { type ProjectionId, type ProjectionStatus } from '@exitbook/core';
import {
  buildAssetReviewFreshnessPorts,
  buildProcessedTransactionsFreshnessPorts,
  buildLinksFreshnessPorts,
} from '@exitbook/data/projections';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandRuntime } from '../../runtime/command-runtime.js';
import { createIngestionRuntime } from '../../runtime/ingestion-runtime.js';
import { createCliLinkingRuntime, readCliLinkOverrides } from '../../runtime/linking-runtime.js';
import { resolveCommandProfile } from '../profiles/profile-resolution.js';

import { createCliAssetReviewProjectionRuntime } from './asset-review-projection-runtime.js';
import { resetProjections } from './projection-reset.js';

const logger = getLogger('projection-readiness');

interface PrereqFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

type RebuildablePrereqId = Exclude<ProjectionId, 'balances'>;

export interface PrereqExecutionOptions {
  isJsonMode: boolean;
  profileId?: number | undefined;
  profileKey?: string | undefined;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

async function resolvePrereqProfileScope(
  scope: CommandRuntime,
  options: Pick<PrereqExecutionOptions, 'profileId' | 'profileKey'>
): Promise<Result<{ profileId: number; profileKey: string }, Error>> {
  const db = await scope.database();

  if (options.profileId !== undefined && options.profileKey !== undefined) {
    return ok({ profileId: options.profileId, profileKey: options.profileKey });
  }

  if (options.profileId !== undefined) {
    const profilesResult = await db.profiles.list();
    if (profilesResult.isErr()) {
      return err(profilesResult.error);
    }

    const profile = profilesResult.value.find((item) => item.id === options.profileId);
    if (!profile) {
      return err(new Error(`Profile not found for ID ${options.profileId}`));
    }

    return ok({ profileId: profile.id, profileKey: profile.profileKey });
  }

  const profileResult = await resolveCommandProfile(scope, db);
  if (profileResult.isErr()) {
    return err(profileResult.error);
  }

  return ok({ profileId: profileResult.value.id, profileKey: profileResult.value.profileKey });
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
  scope: CommandRuntime,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const db = await scope.database();

  return rebuildIfStale(
    'processed-transactions',
    () => buildProcessedTransactionsFreshnessPorts(db).checkFreshness(),
    async (freshness) => {
      if (!options.isJsonMode) {
        console.log(`\nDerived data is stale (${freshness.reason ?? 'unknown'}), reprocessing...\n`);
      }

      const ingestionRuntime = await createIngestionRuntime(scope, db, { presentation: 'headless' });
      const planResult = await ingestionRuntime.processingWorkflow.prepareReprocess({});
      if (planResult.isErr()) return err(planResult.error);

      if (!planResult.value) {
        logger.info('No raw data found to reprocess');
        return ok(undefined);
      }

      const { accountIds } = planResult.value;

      const resetResult = await resetProjections(db, 'processed-transactions', accountIds);
      if (resetResult.isErr()) return err(resetResult.error);

      const processResult = await ingestionRuntime.processingWorkflow.processImportedSessions(accountIds);
      if (processResult.isErr()) return err(processResult.error);

      logger.info({ processed: processResult.value.processed }, 'Reprocess complete');

      if (processResult.value.errors.length > 0) {
        logger.warn({ errors: processResult.value.errors.slice(0, 5) }, 'Processing had errors');
      }

      return ok(undefined);
    }
  );
}

export async function ensureAssetReviewReady(
  scope: CommandRuntime,
  options: Pick<PrereqExecutionOptions, 'profileId' | 'profileKey'>
): Promise<Result<void, Error>> {
  const profileScopeResult = await resolvePrereqProfileScope(scope, options);
  if (profileScopeResult.isErr()) {
    return err(profileScopeResult.error);
  }

  const db = await scope.database();

  return rebuildIfStale(
    'asset-review',
    () => buildAssetReviewFreshnessPorts(db, profileScopeResult.value.profileId).checkFreshness(),
    async () => createCliAssetReviewProjectionRuntime(db, scope.dataDir, profileScopeResult.value).rebuild()
  );
}

export async function ensureLinksReady(
  scope: CommandRuntime,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const db = await scope.database();
  const profileScopeResult = await resolvePrereqProfileScope(scope, options);
  if (profileScopeResult.isErr()) {
    return err(profileScopeResult.error);
  }

  return rebuildIfStale(
    'links',
    () => buildLinksFreshnessPorts(db, profileScopeResult.value.profileId).checkFreshness(),
    async () => {
      const params = {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const linkingRuntimeResult = createCliLinkingRuntime({
        dataDir: scope.dataDir,
        database: db,
        isJsonMode: options.isJsonMode,
        profileId: profileScopeResult.value.profileId,
        profileKey: profileScopeResult.value.profileKey,
      });
      if (linkingRuntimeResult.isErr()) {
        return err(linkingRuntimeResult.error);
      }

      const linkingRuntime = linkingRuntimeResult.value;
      const overridesResult = await readCliLinkOverrides(
        linkingRuntime.overrideStore,
        profileScopeResult.value.profileKey
      );
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
