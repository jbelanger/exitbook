import {
  PriceEnrichmentPipeline,
  type PriceEvent,
  type PricesEnrichOptions,
  type PricesEnrichResult,
} from '@exitbook/accounting';
import { createTransactionLinkQueries, createTransactionQueries } from '@exitbook/data';
// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import type { KyselyDB } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import type { PriceProviderManager } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';

import { PricesEnrichMonitor } from './components/prices-enrich-components.js';
import { createDefaultPriceProviderManager } from './prices-utils.js';

const logger = getLogger('PricesEnrichHandler');

/**
 * Tier 2 handler for `prices enrich`.
 * Factory owns cleanup; command file never calls ctx.onCleanup().
 */
export class PricesEnrichHandler {
  constructor(
    private readonly pipeline: PriceEnrichmentPipeline,
    private readonly priceManager: PriceProviderManager,
    private readonly controller: EventDrivenController<PriceEvent> | undefined
  ) {}

  async execute(params: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    try {
      if (this.controller) {
        await this.controller.start();
      }

      const result = await this.pipeline.execute(params, this.priceManager);

      if (result.isErr()) {
        if (this.controller) {
          this.controller.fail(result.error.message);
          await this.controller.stop();
        }
        return err(result.error);
      }

      if (this.controller) {
        this.controller.complete();
        await this.controller.stop();
      }

      return ok(result.value);
    } catch (error) {
      if (this.controller) {
        const message = error instanceof Error ? error.message : String(error);
        this.controller.fail(message);
        await this.controller.stop().catch((e) => {
          logger.warn({ e }, 'Failed to stop controller after exception');
        });
      }
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  abort(): void {
    if (this.controller) {
      this.controller.abort();
      void this.controller.stop().catch((e) => {
        logger.warn({ e }, 'Failed to stop controller on abort');
      });
    }
  }
}

/**
 * Create a PricesEnrichHandler with appropriate infrastructure.
 * Factory registers ctx.onCleanup() -- command files NEVER do.
 */
export async function createPricesEnrichHandler(
  ctx: CommandContext,
  database: KyselyDB,
  options: { isJsonMode: boolean }
): Promise<Result<PricesEnrichHandler, Error>> {
  const transactionRepository = createTransactionQueries(database);
  const linkRepository = createTransactionLinkQueries(database);

  if (options.isJsonMode) {
    const instrumentation = new InstrumentationCollector();
    const priceManagerResult = await createDefaultPriceProviderManager(instrumentation);
    if (priceManagerResult.isErr()) {
      return err(priceManagerResult.error);
    }
    const priceManager = priceManagerResult.value;
    ctx.onCleanup(async () => priceManager.destroy());

    const pipeline = new PriceEnrichmentPipeline(transactionRepository, linkRepository);
    return ok(new PricesEnrichHandler(pipeline, priceManager, undefined));
  }

  const eventBus = new EventBus<PriceEvent>({
    onError: (busErr) => {
      logger.error({ err: busErr }, 'EventBus error');
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
  ctx.onCleanup(async () => priceManager.destroy());

  const pipeline = new PriceEnrichmentPipeline(transactionRepository, linkRepository, eventBus, instrumentation);
  return ok(new PricesEnrichHandler(pipeline, priceManager, controller));
}
