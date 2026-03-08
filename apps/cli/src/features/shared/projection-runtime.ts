import {
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
import { LinksRunMonitor } from '../links/components/links-run-components.jsx';
import { PricesEnrichMonitor } from '../prices/components/prices-enrich-components.jsx';
import { createDefaultPriceProviderManager } from '../prices/prices-utils.js';

import { createProviderManagerWithStats } from './provider-manager-factory.js';

const logger = getLogger('projection-runtime');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectionFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

export interface ProjectionRuntime {
  checkFreshness(): Promise<Result<ProjectionFreshnessResult, Error>>;
  rebuild(): Promise<Result<void, Error>>;
}

export interface ProjectionRuntimeDeps {
  db: DataContext;
  registry: AdapterRegistry;
  dataDir: string;
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

export type ConsumerTarget = 'links-run' | 'cost-basis' | 'portfolio';

export interface PricePrereqConfig {
  startDate: Date;
  endDate: Date;
}

// ---------------------------------------------------------------------------
// Projection runtime factory
// ---------------------------------------------------------------------------

function buildProjectionRuntimeRegistry(deps: ProjectionRuntimeDeps): Record<ProjectionId, ProjectionRuntime> {
  return {
    'processed-transactions': buildProcessedTransactionsRuntime(deps),
    links: buildLinksRuntime(deps),
  };
}

// ---------------------------------------------------------------------------
// processed-transactions runtime
// ---------------------------------------------------------------------------

function buildProcessedTransactionsRuntime(deps: ProjectionRuntimeDeps): ProjectionRuntime {
  const { db, registry, isJsonMode } = deps;

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

      const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();

      try {
        const eventBus = new EventBus<IngestionEvent>({
          onError: (error) => {
            logger.error({ error }, 'EventBus error during reprocess');
          },
        });

        const ports = buildProcessingPorts(db);
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
  priceConfig?: PricePrereqConfig
): Promise<Result<void, Error>> {
  const projectionTarget: ProjectionId = target === 'links-run' ? 'processed-transactions' : 'links';
  const plan = [...rebuildPlan(projectionTarget), projectionTarget];

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
    const pricesResult = await ensureTransactionPricesReady(deps, priceConfig);
    if (pricesResult.isErr()) return err(pricesResult.error);
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Price coverage prereq
// ---------------------------------------------------------------------------

async function ensureTransactionPricesReady(
  deps: ProjectionRuntimeDeps,
  config: PricePrereqConfig
): Promise<Result<void, Error>> {
  const { db, isJsonMode, setAbort } = deps;

  const data = buildPriceCoverageDataPorts(db);
  const coverageResult = await checkTransactionPriceCoverage(data, config);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (coverageResult.value.complete) {
    logger.info('All prices present for date range, skipping enrichment');
    return ok(undefined);
  }

  logger.info({ reason: coverageResult.value.reason }, 'Price coverage incomplete, running enrichment');

  const { buildPricingPorts } = await import('@exitbook/data');
  const store = buildPricingPorts(db);

  if (isJsonMode) {
    const priceManagerResult = await createDefaultPriceProviderManager();
    if (priceManagerResult.isErr()) return err(priceManagerResult.error);
    const priceManager = priceManagerResult.value;
    try {
      const pipeline = new PriceEnrichmentPipeline(store);
      const fxRateProvider = new StandardFxRateProvider(priceManager);
      const result = await pipeline.execute({}, priceManager, fxRateProvider);
      if (result.isErr()) return err(result.error);
      const postCoverageResult = await verifyTransactionPriceCoverage(data, config);
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

  const priceManagerResult = await createDefaultPriceProviderManager(instrumentation, eventBus);
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

    const pipeline = new PriceEnrichmentPipeline(store, eventBus, instrumentation);
    const fxRateProvider = new StandardFxRateProvider(priceManager);
    const result = await pipeline.execute({}, priceManager, fxRateProvider);

    if (result.isErr()) {
      controller.fail(result.error.message);
      return err(result.error);
    }

    const postCoverageResult = await verifyTransactionPriceCoverage(data, config);
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
  config: PricePrereqConfig
): Promise<Result<void, Error>> {
  const coverageResult = await checkTransactionPriceCoverage(data, config);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (!coverageResult.value.complete) {
    return err(
      new Error(
        `Price coverage remains incomplete after enrichment: ${coverageResult.value.reason ?? 'unknown reason'}`
      )
    );
  }

  return ok(undefined);
}
