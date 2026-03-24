import {
  type AccountingExclusionPolicy,
  checkTransactionPriceCoverage,
  PriceEnrichmentPipeline,
  type PricingEvent,
  StandardFxRateProvider,
} from '@exitbook/accounting';
import { buildPriceCoverageDataPorts } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import type { CommandScope } from '../../runtime/command-scope.js';
import { createEventDrivenController } from '../../ui/shared/index.js';
import { PricesEnrichMonitor } from '../prices/view/prices-enrich-components.jsx';

import { openCliPriceProviderRuntime } from './cli-price-provider-runtime.js';
import type { PrereqExecutionOptions } from './projection-readiness.js';

const logger = getLogger('price-readiness');

export interface PricePrereqConfig {
  startDate: Date;
  endDate: Date;
}

export type PriceReadinessTarget = 'cost-basis' | 'portfolio';

export async function ensureTransactionPricesReady(
  scope: CommandScope,
  options: PrereqExecutionOptions,
  config: PricePrereqConfig,
  target: PriceReadinessTarget,
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
  target: PriceReadinessTarget,
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
