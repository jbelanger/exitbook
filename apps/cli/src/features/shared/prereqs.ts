import {
  LinkingOrchestrator,
  PriceEnrichmentPipeline,
  filterTransactionsByDateRange,
  validateTransactionPrices,
  type LinkingEvent,
  type PriceEvent,
} from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import { createTransactionLinkQueries, createTransactionQueries } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import { err, ok, type Result } from 'neverthrow';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { LinksRunMonitor } from '../links/components/links-run-components.jsx';
import { PricesEnrichMonitor } from '../prices/components/prices-enrich-components.jsx';
import { createDefaultPriceProviderManager } from '../prices/prices-utils.js';

import type { CommandDatabase } from './command-runtime.js';

const logger = getLogger('prereqs');

export interface PrereqExecutionOptions {
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

/**
 * Check if linking is needed (timestamp comparison) and run if so.
 *
 * Compares max(transactions.created_at) vs max(transaction_links.created_at).
 * If newest tx > newest link (or no links exist), re-runs linking.
 */
export async function ensureLinks(
  db: CommandDatabase,
  dataDir: string,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const txRepo = createTransactionQueries(db);
  const linkRepo = createTransactionLinkQueries(db);
  const latestTxResult = await txRepo.getLatestCreatedAt();
  if (latestTxResult.isErr()) return err(latestTxResult.error);

  const latestTx = latestTxResult.value;
  if (!latestTx) {
    logger.info('No transactions found, skipping link check');
    return ok();
  }

  const latestLinkResult = await linkRepo.getLatestCreatedAt();
  if (latestLinkResult.isErr()) return err(latestLinkResult.error);

  const latestLink = latestLinkResult.value;

  // Links are current if they exist and are newer than the latest transaction
  if (latestLink && latestLink >= latestTx) {
    logger.info('Transaction links are up to date, skipping');
    return ok();
  }

  logger.info(
    { latestTx: latestTx.toISOString(), latestLink: latestLink?.toISOString() ?? 'none' },
    'Transaction links are stale, running linking'
  );

  const { OverrideStore } = await import('@exitbook/data');
  const overrideStore = new OverrideStore(dataDir);

  const params = {
    dryRun: false,
    minConfidenceScore: parseDecimal('0.7'),
    autoConfirmThreshold: parseDecimal('0.95'),
  };

  if (options.isJsonMode) {
    const handler = new LinkingOrchestrator(txRepo, linkRepo, overrideStore);
    const result = await handler.execute(params);
    if (result.isErr()) return err(result.error);
    logger.info('Linking completed (JSON mode)');
    return ok();
  }

  console.log('\nTransaction links are stale, running linking...\n');

  // TUI mode: mount LinksRunMonitor
  const eventBus = new EventBus<LinkingEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error during linking');
    },
  });
  const controller = createEventDrivenController(eventBus, LinksRunMonitor, { dryRun: false });
  const abort = () => {
    controller.abort();
    void controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop links controller on abort');
    });
  };

  options.setAbort?.(abort);
  try {
    await controller.start();

    const handler = new LinkingOrchestrator(txRepo, linkRepo, overrideStore, eventBus);
    const result = await handler.execute(params);

    if (result.isErr()) {
      controller.fail(result.error.message);
      return err(result.error);
    }

    controller.complete();
    return ok();
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

/**
 * Check if prices are missing for date range and enrich if so.
 *
 * Fetches transactions, filters by startDate/endDate, validates prices.
 * If missingPricesCount > 0, runs the full PriceEnrichmentPipeline.
 */
export async function ensurePrices(
  db: CommandDatabase,
  startDate: Date,
  endDate: Date,
  currency: string,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const txRepo = createTransactionQueries(db);
  const txResult = await txRepo.getTransactions();
  if (txResult.isErr()) return err(txResult.error);

  const filtered = filterTransactionsByDateRange(txResult.value, startDate, endDate);
  if (filtered.length === 0) {
    logger.info('No transactions in date range, skipping price check');
    return ok();
  }

  const priceCheck = validateTransactionPrices(filtered, currency);
  if (priceCheck.isErr()) {
    // validateTransactionPrices returns an error when ALL transactions are missing prices.
    // This is exactly the case where we should run enrichment rather than failing.
    logger.info('All transactions missing prices, running enrichment');
  } else if (priceCheck.value.missingPricesCount === 0) {
    logger.info('All prices present for date range, skipping enrichment');
    return ok();
  } else {
    logger.info(
      { missingPricesCount: priceCheck.value.missingPricesCount },
      'Some transactions missing prices, running enrichment'
    );
  }

  if (options.isJsonMode) {
    const priceManagerResult = await createDefaultPriceProviderManager();
    if (priceManagerResult.isErr()) return err(priceManagerResult.error);
    const priceManager = priceManagerResult.value;
    try {
      const pipeline = new PriceEnrichmentPipeline(db);
      const result = await pipeline.execute({}, priceManager);
      if (result.isErr()) return err(result.error);
      logger.info('Price enrichment completed (JSON mode)');
      return ok();
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

  options.setAbort?.(abort);
  try {
    await controller.start();

    const pipeline = new PriceEnrichmentPipeline(db, eventBus, instrumentation);
    const result = await pipeline.execute({}, priceManager);

    if (result.isErr()) {
      controller.fail(result.error.message);
      return err(result.error);
    }

    controller.complete();
    return ok();
  } catch (error) {
    const caughtError = error instanceof Error ? error : new Error(String(error));
    controller.fail(caughtError.message);
    return err(caughtError);
  } finally {
    options.setAbort?.(undefined);
    await controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller during cleanup');
    });
    await priceManager.destroy().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to destroy price manager after TUI enrichment');
    });
  }
}
