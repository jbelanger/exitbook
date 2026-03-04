import {
  LinkingOrchestrator,
  PriceEnrichmentPipeline,
  filterTransactionsByDateRange,
  validateTransactionPrices,
  type LinkingEvent,
  type PriceEvent,
} from '@exitbook/accounting';
import { ClearOperation } from '@exitbook/app';
import { parseDecimal } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, RawDataProcessingService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import { err, ok, type Result } from 'neverthrow';

import { createEventDrivenController } from '../../ui/shared/index.js';
import { LinksRunMonitor } from '../links/components/links-run-components.jsx';
import { PricesEnrichMonitor } from '../prices/components/prices-enrich-components.jsx';
import { createDefaultPriceProviderManager } from '../prices/prices-utils.js';

import { createProviderManagerWithStats } from './provider-manager-factory.js';

const logger = getLogger('prereqs');

export interface PrereqExecutionOptions {
  isJsonMode: boolean;
  setAbort?: ((abort: (() => void) | undefined) => void) | undefined;
}

/**
 * Compute a deterministic hash of the current account graph.
 * Changes when accounts are added, removed, or their identifiers change.
 */
async function computeAccountHash(db: DataContext): Promise<Result<string, Error>> {
  const accountsResult = await db.accounts.findAll();
  if (accountsResult.isErr()) return err(accountsResult.error);

  const sorted = accountsResult.value.map((a) => `${a.id}:${a.identifier}`).sort();

  // Use a simple hash — no crypto dependency needed for this
  const raw = sorted.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return ok(hash.toString(36));
}

/**
 * Check if derived data (processed transactions) is stale and reprocess if so.
 *
 * Derived data is stale when:
 * - Raw data has never been processed (first run)
 * - Account graph changed (new account added/removed)
 * - A new import completed since last reprocess
 */
export async function ensureRawDataIsProcessed(
  db: DataContext,
  registry: AdapterRegistry,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  // Check if there's any raw data to process at all
  const rawAccountIdsResult = await db.rawTransactions.findDistinctAccountIds({});
  if (rawAccountIdsResult.isErr()) return err(rawAccountIdsResult.error);
  if (rawAccountIdsResult.value.length === 0) {
    logger.info('No raw data found, skipping reprocess check');
    return ok();
  }

  const accountHashResult = await computeAccountHash(db);
  if (accountHashResult.isErr()) return err(accountHashResult.error);
  const currentHash = accountHashResult.value;

  const metadataResult = await db.rawDataProcessedState.get();
  if (metadataResult.isErr()) return err(metadataResult.error);
  const metadata = metadataResult.value;

  let isStale = false;
  let reason = '';

  if (!metadata) {
    isStale = true;
    reason = 'raw data has never been processed';
  } else if (metadata.accountHash !== currentHash) {
    isStale = true;
    reason = 'account graph changed';
  } else {
    // Check if any import completed after the last build
    const latestImportResult = await db.importSessions.findLatestCompletedAt();
    if (latestImportResult.isErr()) return err(latestImportResult.error);
    const latestImport = latestImportResult.value;

    if (latestImport && latestImport > metadata.processedAt) {
      isStale = true;
      reason = 'new import completed since last build';
    }
  }

  if (!isStale) {
    logger.info('Derived data is up to date, skipping reprocess');
    return ok();
  }

  logger.info({ reason }, 'Derived data is stale, reprocessing');

  if (!options.isJsonMode) {
    console.log(`\nDerived data is stale (${reason}), reprocessing...\n`);
  }

  // Create infrastructure for reprocessing
  const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();

  try {
    const eventBus = new EventBus<IngestionEvent>({
      onError: (error) => {
        logger.error({ error }, 'EventBus error during reprocess');
      },
    });

    const rawDataProcessingService = new RawDataProcessingService(db, providerManager, eventBus, registry);
    const clearOperation = new ClearOperation(db, eventBus);

    // Get all account IDs with raw data
    const allAccountIdsResult = await db.rawTransactions.findDistinctAccountIds({});
    if (allAccountIdsResult.isErr()) return err(allAccountIdsResult.error);
    const accountIds = allAccountIdsResult.value;

    // Guard against incomplete imports
    const guardResult = await rawDataProcessingService.assertNoIncompleteImports(accountIds);
    if (guardResult.isErr()) return err(guardResult.error);

    // Clear derived data and reset raw data to pending
    const clearResult = await clearOperation.execute({ includeRaw: false });
    if (clearResult.isErr()) return err(clearResult.error);

    const deleted = clearResult.value.deleted;
    logger.info(`Cleared derived data (${deleted.links} links, ${deleted.transactions} transactions)`);

    // Reprocess all accounts
    const processResult = await rawDataProcessingService.processImportedSessions(accountIds);
    if (processResult.isErr()) return err(processResult.error);

    logger.info({ processed: processResult.value.processed }, 'Reprocess complete');

    if (processResult.value.errors.length > 0) {
      logger.warn({ errors: processResult.value.errors.slice(0, 5) }, 'Processing had errors');
    }

    // Update rebuild metadata
    const upsertResult = await db.rawDataProcessedState.upsert({
      processedAt: new Date(),
      accountHash: currentHash,
    });
    if (upsertResult.isErr()) return err(upsertResult.error);

    return ok();
  } finally {
    await cleanupProviderManager().catch((e) => {
      logger.warn({ e }, 'Failed to cleanup provider manager after reprocess');
    });
  }
}

/**
 * Check if linking is needed (timestamp comparison) and run if so.
 *
 * Compares max(transactions.created_at) vs max(transaction_links.created_at).
 * If newest tx > newest link (or no links exist), re-runs linking.
 */
export async function ensureLinks(
  db: DataContext,
  dataDir: string,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const latestTxResult = await db.transactions.findLatestCreatedAt();
  if (latestTxResult.isErr()) return err(latestTxResult.error);

  const latestTx = latestTxResult.value;
  if (!latestTx) {
    logger.info('No transactions found, skipping link check');
    return ok();
  }

  const latestLinkResult = await db.transactionLinks.findLatestCreatedAt();
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
    const handler = new LinkingOrchestrator(
      db.transactions,
      db.transactionLinks,
      overrideStore,
      undefined,
      db.linkableMovements
    );
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

    const handler = new LinkingOrchestrator(
      db.transactions,
      db.transactionLinks,
      overrideStore,
      eventBus,
      db.linkableMovements
    );
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
  db: DataContext,
  startDate: Date,
  endDate: Date,
  currency: string,
  options: PrereqExecutionOptions
): Promise<Result<void, Error>> {
  const txResult = await db.transactions.findAll();
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
