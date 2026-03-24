import { PriceEnrichmentPipeline, type AccountingExclusionPolicy, type PricingEvent } from '@exitbook/accounting';
import { buildPricingPorts } from '@exitbook/data/accounting';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { PricesEnrichMonitor } from '../features/prices/view/prices-enrich-components.jsx';
import { createEventDrivenController, type EventDrivenController } from '../ui/shared/index.js';

import { adaptResultCleanup, type CommandScope } from './command-scope.js';

const logger = getLogger('cli-price-enrichment-runtime');

export interface CliPriceEnrichmentRuntime {
  controller?: EventDrivenController<PricingEvent> | undefined;
  instrumentation: InstrumentationCollector;
  pipeline: PriceEnrichmentPipeline;
  priceRuntime: IPriceProviderRuntime;
}

export interface CreateCliPriceEnrichmentRuntimeOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  database: DataSession;
  isJsonMode: boolean;
  registerCleanup?: boolean | undefined;
  scope: CommandScope;
}

export async function createCliPriceEnrichmentRuntime(
  options: CreateCliPriceEnrichmentRuntimeOptions
): Promise<Result<CliPriceEnrichmentRuntime, Error>> {
  let controller: EventDrivenController<PricingEvent> | undefined;
  let priceRuntime: IPriceProviderRuntime | undefined;

  try {
    const store = buildPricingPorts(options.database);
    const instrumentation = new InstrumentationCollector();

    if (options.isJsonMode) {
      const priceRuntimeResult = await options.scope.openPriceProviderRuntime({
        instrumentation,
        registerCleanup: options.registerCleanup,
      });
      if (priceRuntimeResult.isErr()) {
        return err(priceRuntimeResult.error);
      }

      priceRuntime = priceRuntimeResult.value;
      return ok({
        instrumentation,
        pipeline: new PriceEnrichmentPipeline(store, undefined, instrumentation, options.accountingExclusionPolicy),
        priceRuntime,
      });
    }

    const eventBus = new EventBus<PricingEvent>({
      onError: (error) => {
        logger.error({ error }, 'EventBus error during price enrichment');
      },
    });
    controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

    const priceRuntimeResult = await options.scope.openPriceProviderRuntime({
      instrumentation,
      eventBus,
      registerCleanup: options.registerCleanup,
    });
    if (priceRuntimeResult.isErr()) {
      controller.fail(priceRuntimeResult.error.message);
      await controller.stop();
      return err(priceRuntimeResult.error);
    }

    priceRuntime = priceRuntimeResult.value;
    return ok({
      controller,
      instrumentation,
      pipeline: new PriceEnrichmentPipeline(store, eventBus, instrumentation, options.accountingExclusionPolicy),
      priceRuntime,
    });
  } catch (error) {
    const runtimeError = error instanceof Error ? error : new Error(String(error));
    controller?.fail(runtimeError.message);
    await controller?.stop().catch((controllerError) => {
      logger.warn({ controllerError }, 'Failed to stop price-enrichment controller after setup failure');
    });

    if (priceRuntime && options.registerCleanup === false) {
      await adaptResultCleanup(priceRuntime.cleanup)().catch((cleanupError) => {
        logger.warn({ cleanupError }, 'Failed to clean up price runtime after setup failure');
      });
    }

    return err(runtimeError);
  }
}
