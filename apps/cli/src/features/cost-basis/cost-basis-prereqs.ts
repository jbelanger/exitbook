import type { TransactionLinkQueries } from '@exitbook/accounting';
import { parseDecimal } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { LinksRunMonitor } from '../links/components/links-run-components.js';
import type { LinkingEvent } from '../links/events.js';
import { LinksRunHandler } from '../links/links-run-handler.js';
import { PricesEnrichMonitor } from '../prices/components/prices-enrich-components.js';
import type { PriceEvent } from '../prices/events.js';
import { PricesEnrichHandler } from '../prices/prices-enrich-handler.js';
import type { CommandContext } from '../shared/command-runtime.js';

import { filterTransactionsByDateRange, validateTransactionPrices } from './cost-basis-utils.js';

const logger = getLogger('cost-basis-prereqs');

/**
 * Check if linking is needed (timestamp comparison) and run if so.
 *
 * Compares max(transactions.created_at) vs max(transaction_links.created_at).
 * If newest tx > newest link (or no links exist), re-runs linking.
 */
export async function ensureLinks(
  txRepo: TransactionQueries,
  linkRepo: TransactionLinkQueries,
  dataDir: string,
  ctx: CommandContext,
  isJsonMode: boolean
): Promise<Result<void, Error>> {
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

  if (!isJsonMode) {
    console.log('\nTransaction links are stale, running linking...\n');
  }

  const { OverrideStore } = await import('@exitbook/data');
  const overrideStore = new OverrideStore(dataDir);

  const params = {
    dryRun: false,
    minConfidenceScore: parseDecimal('0.7'),
    autoConfirmThreshold: parseDecimal('0.95'),
  };

  if (isJsonMode) {
    const handler = new LinksRunHandler(txRepo, linkRepo, overrideStore);
    const result = await handler.execute(params);
    if (result.isErr()) return err(result.error);
    logger.info('Linking completed (JSON mode)');
    return ok();
  }

  // TUI mode: mount LinksRunMonitor
  const eventBus = new EventBus<LinkingEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error during linking');
    },
  });
  const controller = createEventDrivenController(eventBus, LinksRunMonitor, { dryRun: false });

  ctx.onAbort(() => {
    controller.abort();
    void controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop links controller on abort');
    });
  });

  controller.start();

  const handler = new LinksRunHandler(txRepo, linkRepo, overrideStore, eventBus);
  const result = await handler.execute(params);

  if (result.isErr()) {
    controller.fail(result.error.message);
    await controller.stop();
    return err(result.error);
  }

  controller.complete();
  await controller.stop();
  return ok();
}

/**
 * Check if prices are missing for date range and enrich if so.
 *
 * Fetches transactions, filters by startDate/endDate, validates prices.
 * If missingPricesCount > 0, runs the full PricesEnrichHandler pipeline.
 */
export async function ensurePrices(
  txRepo: TransactionQueries,
  linkRepo: TransactionLinkQueries,
  startDate: Date,
  endDate: Date,
  currency: string,
  ctx: CommandContext,
  isJsonMode: boolean
): Promise<Result<void, Error>> {
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

  if (!isJsonMode) {
    console.log('\nPrices missing for requested date range, running enrichment...\n');
  }

  if (isJsonMode) {
    const handler = new PricesEnrichHandler(txRepo, linkRepo);
    ctx.onCleanup(async () => handler.destroy());

    const result = await handler.execute({});
    if (result.isErr()) return err(result.error);
    logger.info('Price enrichment completed (JSON mode)');
    return ok();
  }

  // TUI mode: mount PricesEnrichMonitor
  const eventBus = new EventBus<PriceEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error during price enrichment');
    },
  });
  const instrumentation = new InstrumentationCollector();
  const controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

  const handler = new PricesEnrichHandler(txRepo, linkRepo, eventBus, instrumentation);
  ctx.onCleanup(async () => handler.destroy());

  ctx.onAbort(() => {
    controller.abort();
    void controller.stop().catch((cleanupErr) => {
      logger.warn({ cleanupErr }, 'Failed to stop prices controller on abort');
    });
  });

  controller.start();

  const result = await handler.execute({});

  if (result.isErr()) {
    controller.fail(result.error.message);
    await controller.stop();
    return err(result.error);
  }

  controller.complete();
  await controller.stop();
  return ok();
}
