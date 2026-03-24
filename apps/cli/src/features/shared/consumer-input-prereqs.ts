import {
  type AccountingExclusionPolicy,
  checkTransactionPriceCoverage,
  LinkingOrchestrator,
  PriceEnrichmentPipeline,
  type PricingEvent,
  StandardFxRateProvider,
  type LinkingEvent,
} from '@exitbook/accounting';
import { type ProjectionId, type ProjectionStatus, resetPlan } from '@exitbook/core';
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
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import type { CommandScope } from '../../runtime/command-scope.js';
import { createEventDrivenController } from '../../ui/shared/index.js';
import { LinksRunMonitor } from '../links/view/links-run-components.jsx';
import { PricesEnrichMonitor } from '../prices/view/prices-enrich-components.jsx';

import { rebuildAssetReviewProjection } from './asset-review-projection-runtime.js';
import { withCliBlockchainProviderRuntimeResult } from './blockchain-provider-runtime.js';
import { openCliPriceProviderRuntime } from './cli-price-provider-runtime.js';

const logger = getLogger('consumer-input-prereqs');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrereqFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

type ConsumerTarget = 'links-run' | 'cost-basis' | 'portfolio';
type RebuildablePrereqId = Exclude<ProjectionId, 'balances'>;

interface PricePrereqConfig {
  startDate: Date;
  endDate: Date;
}

interface PrereqExecutionOptions {
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

interface EnsureConsumerInputsReadyOptions extends PrereqExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  priceConfig?: PricePrereqConfig | undefined;
}

export interface ProjectionResetImpact {
  assetReview: { assets: number };
  balances: { assetRows: number; scopes: number };
  links: { links: number };
  processedTransactions: { transactions: number };
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

          const overrideStore = new OverrideStore(scope.dataDir);
          const ports = buildProcessingPorts(db, {
            rebuildAssetReviewProjection: () => rebuildAssetReviewProjection(db, scope.dataDir),
            overrideStore,
          });
          const processingWorkflow = new ProcessingWorkflow(
            ports,
            providerRuntime,
            eventBus,
            appRuntime.adapterRegistry
          );

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
    async () => rebuildAssetReviewProjection(db, scope.dataDir)
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
      const overrideStore = new OverrideStore(scope.dataDir);

      let overrides: import('@exitbook/core').OverrideEvent[] = [];
      if (overrideStore.exists()) {
        const overridesResult = await overrideStore.readByScopes(['link', 'unlink']);
        if (overridesResult.isErr()) {
          return err(new Error(`Failed to read override events: ${overridesResult.error.message}`));
        }
        overrides = overridesResult.value;
      }

      const params = {
        minConfidenceScore: parseDecimal('0.7'),
        autoConfirmThreshold: parseDecimal('0.95'),
      };

      const store = buildLinkingPorts(db);

      if (options.isJsonMode) {
        const orchestrator = new LinkingOrchestrator(store);
        const result = await orchestrator.execute(params, overrides);
        if (result.isErr()) return err(result.error);
        logger.info('Linking completed (JSON mode)');
        return ok(undefined);
      }

      console.log('\nTransaction links are stale, running linking...\n');

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

      options.setAbort?.(abort);
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
        options.setAbort?.(undefined);
        await controller.stop().catch((cleanupErr) => {
          logger.warn({ cleanupErr }, 'Failed to stop links controller during cleanup');
        });
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Projection reset utility
// ---------------------------------------------------------------------------

/**
 * Reset projections in graph order using resetPlan.
 * Used by both ensureConsumerInputsReady (implicit rebuild) and
 * explicit reset commands (reprocess, clear).
 */
export async function countProjectionResetImpact(
  db: DataContext,
  target: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact, Error>> {
  const plan = resetPlan(target);
  const impact = createEmptyProjectionResetImpact();

  for (const projectionId of plan) {
    const result = await countSingleProjection(db, projectionId, accountIds);
    if (result.isErr()) return err(result.error);
    assignProjectionResetImpact(impact, projectionId, result.value);
  }

  return ok(impact);
}

export async function resetProjections(
  db: DataContext,
  target: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact, Error>> {
  return db.executeInTransaction(async (txDb) => {
    const plan = resetPlan(target);
    const impact = createEmptyProjectionResetImpact();

    for (const projectionId of plan) {
      const result = await resetSingleProjection(txDb, projectionId, accountIds);
      if (result.isErr()) return err(result.error);
      assignProjectionResetImpact(impact, projectionId, result.value);
    }

    return ok(impact);
  });
}

async function countSingleProjection(
  db: DataContext,
  projectionId: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact[ProjectionIdToImpactKey<typeof projectionId>], Error>> {
  switch (projectionId) {
    case 'asset-review': {
      const adapter = buildAssetReviewResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'balances': {
      const adapter = buildBalancesResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'links': {
      const adapter = buildLinksResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'processed-transactions': {
      const adapter = buildProcessedTransactionsResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
  }
}

async function resetSingleProjection(
  db: DataContext,
  projectionId: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact[ProjectionIdToImpactKey<typeof projectionId>], Error>> {
  switch (projectionId) {
    case 'asset-review': {
      const adapter = buildAssetReviewResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'balances': {
      const adapter = buildBalancesResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'links': {
      const adapter = buildLinksResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'processed-transactions': {
      const adapter = buildProcessedTransactionsResetPorts(db);
      return adapter.reset(accountIds);
    }
  }
}

type ProjectionIdToImpactKey<T extends ProjectionId> = T extends 'asset-review'
  ? 'assetReview'
  : T extends 'processed-transactions'
    ? 'processedTransactions'
    : T;

function createEmptyProjectionResetImpact(): ProjectionResetImpact {
  return {
    processedTransactions: { transactions: 0 },
    assetReview: { assets: 0 },
    balances: { scopes: 0, assetRows: 0 },
    links: { links: 0 },
  };
}

function assignProjectionResetImpact(
  impact: ProjectionResetImpact,
  projectionId: ProjectionId,
  projectionImpact:
    | ProjectionResetImpact['assetReview']
    | ProjectionResetImpact['balances']
    | ProjectionResetImpact['links']
    | ProjectionResetImpact['processedTransactions']
): void {
  switch (projectionId) {
    case 'asset-review':
      impact.assetReview = projectionImpact as ProjectionResetImpact['assetReview'];
      return;
    case 'balances':
      impact.balances = projectionImpact as ProjectionResetImpact['balances'];
      return;
    case 'links':
      impact.links = projectionImpact as ProjectionResetImpact['links'];
      return;
    case 'processed-transactions':
      impact.processedTransactions = projectionImpact as ProjectionResetImpact['processedTransactions'];
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
  scope: CommandScope,
  target: ConsumerTarget,
  options: EnsureConsumerInputsReadyOptions
): Promise<Result<void, Error>> {
  const processedTransactionsResult = await ensureProcessedTransactionsReady(scope, options);
  if (processedTransactionsResult.isErr()) {
    return err(processedTransactionsResult.error);
  }

  if (target === 'links-run') {
    return ok(undefined);
  }

  const assetReviewResult = await ensureAssetReviewReady(scope);
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const linksResult = await ensureLinksReady(scope, options);
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  if ((target === 'cost-basis' || target === 'portfolio') && options.priceConfig) {
    const pricesResult = await ensureTransactionPricesReady(
      scope,
      options,
      options.priceConfig,
      target,
      options.accountingExclusionPolicy
    );
    if (pricesResult.isErr()) {
      return err(pricesResult.error);
    }
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Price coverage prereq
// ---------------------------------------------------------------------------

async function ensureTransactionPricesReady(
  scope: CommandScope,
  options: PrereqExecutionOptions,
  config: PricePrereqConfig,
  target: Extract<ConsumerTarget, 'cost-basis' | 'portfolio'>,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const db = await scope.database();
  const { isJsonMode, setAbort } = options;
  const appRuntime = scope.requireAppRuntime();

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
    const priceRuntimeResult = await openCliPriceProviderRuntime({
      dataDir: scope.dataDir,
      providers: appRuntime.priceProviderConfig,
    });
    if (priceRuntimeResult.isErr()) return err(priceRuntimeResult.error);
    const priceRuntime = priceRuntimeResult.value;
    try {
      const pipeline = new PriceEnrichmentPipeline(store, undefined, undefined, accountingExclusionPolicy);
      const fxRateProvider = new StandardFxRateProvider(priceRuntime);
      const result = await pipeline.execute({}, priceRuntime, fxRateProvider);
      if (result.isErr()) return err(result.error);
      const postCoverageResult = await verifyTransactionPriceCoverage(data, config, target, accountingExclusionPolicy);
      if (postCoverageResult.isErr()) return err(postCoverageResult.error);
      logger.info('Price enrichment completed (JSON mode)');
      return ok(undefined);
    } finally {
      const cleanupResult = await priceRuntime.cleanup();
      if (cleanupResult.isErr()) {
        logger.warn({ error: cleanupResult.error }, 'Failed to clean up price runtime after JSON enrichment');
      }
    }
  }

  console.log('\nPrices missing for requested date range, running enrichment...\n');

  // TUI mode: mount PricesEnrichMonitor
  const eventBus = new EventBus<PricingEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error during price enrichment');
    },
  });
  const instrumentation = new InstrumentationCollector();
  const controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

  const priceRuntimeResult = await openCliPriceProviderRuntime({
    dataDir: scope.dataDir,
    instrumentation,
    eventBus,
    providers: appRuntime.priceProviderConfig,
  });
  if (priceRuntimeResult.isErr()) {
    controller.fail(priceRuntimeResult.error.message);
    await controller.stop();
    return err(priceRuntimeResult.error);
  }
  const priceRuntime = priceRuntimeResult.value;
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
    const fxRateProvider = new StandardFxRateProvider(priceRuntime);
    const result = await pipeline.execute({}, priceRuntime, fxRateProvider);

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
    const cleanupResult = await priceRuntime.cleanup();
    if (cleanupResult.isErr()) {
      logger.warn({ error: cleanupResult.error }, 'Failed to clean up price runtime after TUI enrichment');
    }
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
