import { type AccountingExclusionPolicy, checkTransactionPriceCoverage } from '@exitbook/accounting';
import { buildPriceCoverageDataPorts } from '@exitbook/data/accounting';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { adaptResultCleanup, type CommandScope } from '../../runtime/command-scope.js';
import { createCliPriceEnrichmentRuntime } from '../../runtime/price-enrichment-runtime.js';

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

  const data = buildPriceCoverageDataPorts(db);
  const coverageResult = await checkTransactionPriceCoverage(data, config, accountingExclusionPolicy);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (coverageResult.value.complete) {
    logger.info('All prices present for date range, skipping enrichment');
    return ok(undefined);
  }

  logger.info({ reason: coverageResult.value.reason }, 'Price coverage incomplete, running enrichment');

  if (!isJsonMode) {
    console.log('\nPrices missing for requested date range, running enrichment...\n');
  }

  const priceEnrichmentRuntimeResult = await createCliPriceEnrichmentRuntime({
    accountingExclusionPolicy,
    database: db,
    isJsonMode,
    registerCleanup: false,
    scope,
  });
  if (priceEnrichmentRuntimeResult.isErr()) return err(priceEnrichmentRuntimeResult.error);

  const priceEnrichmentRuntime = priceEnrichmentRuntimeResult.value;
  const controller = priceEnrichmentRuntime.controller;
  const cleanupPriceRuntime = adaptResultCleanup(priceEnrichmentRuntime.priceRuntime.cleanup);

  const abort = () => {
    if (!controller) {
      return;
    }

    controller.abort();
    void controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller on abort');
    });
  };

  setAbort?.(abort);
  try {
    if (controller) {
      await controller.start();
    }

    const result = await priceEnrichmentRuntime.pipeline.execute({}, priceEnrichmentRuntime.priceRuntime);

    if (result.isErr()) {
      controller?.fail(result.error.message);
      return err(result.error);
    }

    const postCoverageResult = await verifyTransactionPriceCoverage(data, config, target, accountingExclusionPolicy);
    if (postCoverageResult.isErr()) {
      controller?.fail(postCoverageResult.error.message);
      return err(postCoverageResult.error);
    }

    controller?.complete();
    if (isJsonMode) {
      logger.info('Price enrichment completed (JSON mode)');
    }
    return ok(undefined);
  } catch (error) {
    const caughtError = error instanceof Error ? error : new Error(String(error));
    controller?.fail(caughtError.message);
    return err(caughtError);
  } finally {
    setAbort?.(undefined);
    await controller?.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller during cleanup');
    });
    await cleanupPriceRuntime().catch((cleanupError) => {
      logger.warn({ cleanupError }, 'Failed to clean up price runtime after enrichment');
    });
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
