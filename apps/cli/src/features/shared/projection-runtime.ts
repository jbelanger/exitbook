import {
  type AccountingExclusionPolicy,
  checkTransactionPriceCoverage,
  LinkingOrchestrator,
  PriceEnrichmentPipeline,
  StandardFxRateProvider,
  type LinkingEvent,
  type PriceEvent,
} from '@exitbook/accounting';
import {
  type ProjectionId,
  type ProjectionStatus,
  err,
  ok,
  parseDecimal,
  rebuildPlan,
  resetPlan,
  type Result,
} from '@exitbook/core';
import {
  buildAssetReviewFreshnessPorts,
  buildAssetReviewResetPorts,
  buildBalancesResetPorts,
  buildLinkingPorts,
  buildLinksFreshnessPorts,
  buildLinksResetPorts,
  buildPriceCoverageDataPorts,
  buildProcessedTransactionsFreshnessPorts,
  buildProcessedTransactionsResetPorts,
  buildProcessingPorts,
  OverrideStore,
  type DataContext,
} from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { LinksRunMonitor } from '../links/view/links-run-components.jsx';
import { createDefaultPriceProviderManager } from '../prices/command/prices-utils.js';
import { PricesEnrichMonitor } from '../prices/view/prices-enrich-components.jsx';

import { rebuildAssetReviewProjection } from './asset-review-projection-runtime.js';
import { openBlockchainProviderRuntime } from './blockchain-provider-runtime.js';

const logger = getLogger('projection-runtime');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectionFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

interface ProjectionRuntime {
  checkFreshness(): Promise<Result<ProjectionFreshnessResult, Error>>;
  rebuild(): Promise<Result<void, Error>>;
}

interface ProjectionRuntimeDeps {
  db: DataContext;
  registry: AdapterRegistry;
  dataDir: string;
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

type ConsumerTarget = 'links-run' | 'cost-basis' | 'portfolio';

interface PricePrereqConfig {
  startDate: Date;
  endDate: Date;
}

type GlobalProjectionId = Exclude<ProjectionId, 'balances'>;

// ---------------------------------------------------------------------------
// Projection runtime factory
// ---------------------------------------------------------------------------

function buildProjectionRuntimeRegistry(deps: ProjectionRuntimeDeps): Record<GlobalProjectionId, ProjectionRuntime> {
  return {
    'processed-transactions': buildProcessedTransactionsRuntime(deps),
    'asset-review': buildAssetReviewRuntime(deps),
    links: buildLinksRuntime(deps),
  };
}

// ---------------------------------------------------------------------------
// processed-transactions runtime
// ---------------------------------------------------------------------------

function buildProcessedTransactionsRuntime(deps: ProjectionRuntimeDeps): ProjectionRuntime {
  const { db, registry, isJsonMode, dataDir } = deps;

  return {
    checkFreshness() {
      return buildProcessedTransactionsFreshnessPorts(db).checkFreshness();
    },

    async rebuild() {
      if (!isJsonMode) {
        const freshnessResult = await buildProcessedTransactionsFreshnessPorts(db).checkFreshness();
        const reason = freshnessResult.isOk() ? freshnessResult.value.reason : 'unknown';
        console.log(`\nDerived data is stale (${reason}), reprocessing...\n`);
      }

      const { providerManager, cleanup: cleanupProviderManager } = await openBlockchainProviderRuntime(undefined, {
        dataDir,
      });

      try {
        const eventBus = new EventBus<IngestionEvent>({
          onError: (error) => {
            logger.error({ error }, 'EventBus error during reprocess');
          },
        });

        const ports = buildProcessingPorts(db, {
          rebuildAssetReviewProjection: () => rebuildAssetReviewProjection(db, dataDir),
        });
        const processingWorkflow = new ProcessingWorkflow(ports, providerManager, eventBus, registry);

        // 1. Plan: resolve accounts and guard incomplete imports
        const planResult = await processingWorkflow.prepareReprocess({});
        if (planResult.isErr()) return err(planResult.error);

        if (!planResult.value) {
          logger.info('No raw data found to reprocess');
          return ok(undefined);
        }

        const { accountIds } = planResult.value;

        // 2. Reset projections in graph order (downstream first)
        const resetResult = await resetProjections(db, 'processed-transactions', accountIds);
        if (resetResult.isErr()) return err(resetResult.error);

        // 3. Process raw data
        const processResult = await processingWorkflow.processImportedSessions(accountIds);
        if (processResult.isErr()) return err(processResult.error);

        logger.info({ processed: processResult.value.processed }, 'Reprocess complete');

        if (processResult.value.errors.length > 0) {
          logger.warn({ errors: processResult.value.errors.slice(0, 5) }, 'Processing had errors');
        }

        return ok(undefined);
      } finally {
        await cleanupProviderManager().catch((e) => {
          logger.warn({ e }, 'Failed to cleanup provider manager after reprocess');
        });
      }
    },
  };
}

function buildAssetReviewRuntime(deps: ProjectionRuntimeDeps): ProjectionRuntime {
  const { db, dataDir } = deps;

  return {
    checkFreshness() {
      return buildAssetReviewFreshnessPorts(db).checkFreshness();
    },

    async rebuild() {
      return rebuildAssetReviewProjection(db, dataDir);
    },
  };
}

// ---------------------------------------------------------------------------
// links runtime
// ---------------------------------------------------------------------------

function buildLinksRuntime(deps: ProjectionRuntimeDeps): ProjectionRuntime {
  const { db, dataDir, isJsonMode, setAbort } = deps;

  return {
    checkFreshness() {
      return buildLinksFreshnessPorts(db).checkFreshness();
    },

    async rebuild() {
      const overrideStore = new OverrideStore(dataDir);

      let overrides: import('@exitbook/core').OverrideEvent[] = [];
      if (overrideStore.exists()) {
        const overridesResult = await overrideStore.readByScopes(['link', 'unlink']);
        if (overridesResult.isErr())
          return err(new Error(`Failed to read override events: ${overridesResult.error.message}`));
        overrides = overridesResult.value;
      }

      const params = {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const store = buildLinkingPorts(db);

      if (isJsonMode) {
        const orchestrator = new LinkingOrchestrator(store);
        const result = await orchestrator.execute(params, overrides);
        if (result.isErr()) return err(result.error);
        logger.info('Linking completed (JSON mode)');
        return ok(undefined);
      }

      console.log('\nTransaction links are stale, running linking...\n');

      // TUI mode: mount LinksRunMonitor
      const eventBus = new EventBus<LinkingEvent>({
        onError: (error) => {
          logger.error({ error }, 'EventBus error during linking');
        },
      });
      const controller = createEventDrivenController(eventBus, LinksRunMonitor, {});
      const abort = () => {
        controller.abort();
        void controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop links controller on abort');
        });
      };

      setAbort?.(abort);
      try {
        await controller.start();

        const orchestrator = new LinkingOrchestrator(store, eventBus);
        const result = await orchestrator.execute(params, overrides);

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
        setAbort?.(undefined);
        await controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop links controller during cleanup');
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Projection reset utility
// ---------------------------------------------------------------------------

/**
 * Reset projections in graph order using resetPlan.
 * Used by both ensureConsumerInputsReady (implicit rebuild) and
 * explicit reset commands (reprocess, clear).
 */
export async function resetProjections(
  db: DataContext,
  target: ProjectionId,
  accountIds?: number[]
): Promise<Result<void, Error>> {
  return db.executeInTransaction(async (txDb) => {
    const plan = resetPlan(target);

    for (const projectionId of plan) {
      const result = await resetSingleProjection(txDb, projectionId, accountIds);
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  });
}

async function resetSingleProjection(
  db: DataContext,
  projectionId: ProjectionId,
  accountIds?: number[]
): Promise<Result<void, Error>> {
  switch (projectionId) {
    case 'asset-review': {
      const adapter = buildAssetReviewResetPorts(db);
      const result = await adapter.reset(accountIds);
      return result.isErr() ? err(result.error) : ok(undefined);
    }
    case 'balances': {
      const adapter = buildBalancesResetPorts(db);
      const result = await adapter.reset(accountIds);
      return result.isErr() ? err(result.error) : ok(undefined);
    }
    case 'links': {
      const adapter = buildLinksResetPorts(db);
      const result = await adapter.reset(accountIds);
      return result.isErr() ? err(result.error) : ok(undefined);
    }
    case 'processed-transactions': {
      const adapter = buildProcessedTransactionsResetPorts(db);
      const result = await adapter.reset(accountIds);
      return result.isErr() ? err(result.error) : ok(undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Consumer readiness API
// ---------------------------------------------------------------------------

/**
 * Ensure all upstream projections are fresh for the given consumer target,
 * rebuilding stale projections in dependency order.
 *
 * After projection readiness, checks price coverage for consumers that need it.
 */
export async function ensureConsumerInputsReady(
  target: ConsumerTarget,
  deps: ProjectionRuntimeDeps,
  priceConfig?: PricePrereqConfig,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const plan = buildConsumerProjectionPlan(target);

  const registry = buildProjectionRuntimeRegistry(deps);

  for (const projectionId of plan) {
    const freshness = await registry[projectionId].checkFreshness();
    if (freshness.isErr()) return err(freshness.error);

    if (freshness.value.status !== 'fresh') {
      logger.info(
        { projectionId, status: freshness.value.status, reason: freshness.value.reason },
        'Projection is stale, rebuilding'
      );

      const rebuild = await registry[projectionId].rebuild();
      if (rebuild.isErr()) return err(rebuild.error);
    }
  }

  // Price coverage prereq (not a projection)
  if ((target === 'cost-basis' || target === 'portfolio') && priceConfig) {
    const pricesResult = await ensureTransactionPricesReady(deps, priceConfig, target, accountingExclusionPolicy);
    if (pricesResult.isErr()) return err(pricesResult.error);
  }

  return ok(undefined);
}

function buildConsumerProjectionPlan(target: ConsumerTarget): GlobalProjectionId[] {
  if (target === 'links-run') {
    return ['processed-transactions'];
  }

  return [
    ...new Set<GlobalProjectionId>([
      ...rebuildPlan('asset-review'),
      'asset-review',
      ...rebuildPlan('links'),
      'links',
    ] as GlobalProjectionId[]),
  ];
}

// ---------------------------------------------------------------------------
// Price coverage prereq
// ---------------------------------------------------------------------------

async function ensureTransactionPricesReady(
  deps: ProjectionRuntimeDeps,
  config: PricePrereqConfig,
  target: Extract<ConsumerTarget, 'cost-basis' | 'portfolio'>,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const { db, isJsonMode, setAbort } = deps;

  const data = buildPriceCoverageDataPorts(db);
  const coverageResult = await checkTransactionPriceCoverage(data, config, accountingExclusionPolicy);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (coverageResult.value.complete) {
    logger.info('All prices present for date range, skipping enrichment');
    return ok(undefined);
  }

  logger.info({ reason: coverageResult.value.reason }, 'Price coverage incomplete, running enrichment');

  const { buildPricingPorts } = await import('@exitbook/data');
  const store = buildPricingPorts(db);

  if (isJsonMode) {
    const priceManagerResult = await createDefaultPriceProviderManager(deps.dataDir);
    if (priceManagerResult.isErr()) return err(priceManagerResult.error);
    const priceManager = priceManagerResult.value;
    try {
      const pipeline = new PriceEnrichmentPipeline(store, undefined, undefined, accountingExclusionPolicy);
      const fxRateProvider = new StandardFxRateProvider(priceManager);
      const result = await pipeline.execute({}, priceManager, fxRateProvider);
      if (result.isErr()) return err(result.error);
      const postCoverageResult = await verifyTransactionPriceCoverage(data, config, target, accountingExclusionPolicy);
      if (postCoverageResult.isErr()) return err(postCoverageResult.error);
      logger.info('Price enrichment completed (JSON mode)');
      return ok(undefined);
    } finally {
      await priceManager.destroy().catch((cleanupErr) => {
        logger.warn({ cleanupErr }, 'Failed to destroy price manager after JSON enrichment');
      });
    }
  }

  console.log('\nPrices missing for requested date range, running enrichment...\n');

  // TUI mode: mount PricesEnrichMonitor
  const eventBus = new EventBus<PriceEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error during price enrichment');
    },
  });
  const instrumentation = new InstrumentationCollector();
  const controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

  const priceManagerResult = await createDefaultPriceProviderManager(deps.dataDir, instrumentation, eventBus);
  if (priceManagerResult.isErr()) {
    controller.fail(priceManagerResult.error.message);
    await controller.stop();
    return err(priceManagerResult.error);
  }
  const priceManager = priceManagerResult.value;
  const abort = () => {
    controller.abort();
    void controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller on abort');
    });
  };

  setAbort?.(abort);
  try {
    await controller.start();

    const pipeline = new PriceEnrichmentPipeline(store, eventBus, instrumentation, accountingExclusionPolicy);
    const fxRateProvider = new StandardFxRateProvider(priceManager);
    const result = await pipeline.execute({}, priceManager, fxRateProvider);

    if (result.isErr()) {
      controller.fail(result.error.message);
      return err(result.error);
    }

    const postCoverageResult = await verifyTransactionPriceCoverage(data, config, target, accountingExclusionPolicy);
    if (postCoverageResult.isErr()) {
      controller.fail(postCoverageResult.error.message);
      return err(postCoverageResult.error);
    }

    controller.complete();
    return ok(undefined);
  } catch (error) {
    const caughtError = error instanceof Error ? error : new Error(String(error));
    controller.fail(caughtError.message);
    return err(caughtError);
  } finally {
    setAbort?.(undefined);
    await controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller during cleanup');
    });
    await priceManager.destroy().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to destroy price manager after TUI enrichment');
    });
  }
}

async function verifyTransactionPriceCoverage(
  data: ReturnType<typeof buildPriceCoverageDataPorts>,
  config: PricePrereqConfig,
  target: Extract<ConsumerTarget, 'cost-basis' | 'portfolio'>,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const coverageResult = await checkTransactionPriceCoverage(data, config, accountingExclusionPolicy);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (!coverageResult.value.complete) {
    if (target === 'portfolio') {
      logger.warn(
        { reason: coverageResult.value.reason },
        'Price coverage remains incomplete after enrichment; allowing portfolio to continue with exclusions'
      );
      return ok(undefined);
    }

    return err(
      new Error(
        `Price coverage remains incomplete after enrichment: ${coverageResult.value.reason ?? 'unknown reason'}`
      )
    );
  }

  return ok(undefined);
}
