import type { AccountingExclusionPolicy } from '@exitbook/accounting/accounting-model';
import {
  PriceEnrichmentPipeline,
  type PricingEvent,
  type PricesEnrichOptions,
  type PricesEnrichResult,
} from '@exitbook/accounting/price-enrichment';
import { buildPricingPorts } from '@exitbook/data/accounting';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { CliOutputFormat } from '../../../cli/options.js';
import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { createEventDrivenController, type EventDrivenController } from '../../../ui/shared/controllers.js';
import { PricesEnrichMonitor } from '../view/prices-enrich-components.jsx';

const logger = getLogger('cli-price-enrichment-runtime');

interface CliPriceEnrichmentRuntime {
  controller?: EventDrivenController<PricingEvent> | undefined;
  instrumentation: InstrumentationCollector;
  pipeline: PriceEnrichmentPipeline;
  priceRuntime: IPriceProviderRuntime;
}

interface CreateCliPriceEnrichmentRuntimeOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  database: DataSession;
  format: CliOutputFormat;
  profileId: number;
  registerCleanup?: boolean | undefined;
  scope: CommandRuntime;
}

interface ExecuteCliPriceEnrichmentRuntimeOptions<TSuccess = PricesEnrichResult> {
  afterSuccess?:
    | ((result: PricesEnrichResult, runtime: CliPriceEnrichmentRuntime) => Promise<Result<TSuccess, Error>>)
    | undefined;
  params: PricesEnrichOptions;
}

interface WithCliPriceEnrichmentRuntimeOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  database: Awaited<ReturnType<CommandRuntime['database']>>;
  format: CliOutputFormat;
  onAbortRegistered?: ((abort: () => void) => void) | undefined;
  onAbortReleased?: (() => void) | undefined;
  profileId: number;
  scope: CommandRuntime;
}

async function createCliPriceEnrichmentRuntime(
  options: CreateCliPriceEnrichmentRuntimeOptions
): Promise<Result<CliPriceEnrichmentRuntime, Error>> {
  let controller: EventDrivenController<PricingEvent> | undefined;
  let priceRuntime: IPriceProviderRuntime | undefined;

  try {
    const store = buildPricingPorts(options.database, options.profileId);
    const instrumentation = new InstrumentationCollector();

    if (options.format === 'json') {
      priceRuntime = await options.scope.openPriceProviderRuntime({
        instrumentation,
        registerCleanup: options.registerCleanup,
      });
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

    priceRuntime = await options.scope.openPriceProviderRuntime({
      instrumentation,
      eventBus,
      registerCleanup: options.registerCleanup,
    });
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

export async function executeCliPriceEnrichmentRuntime<TSuccess = PricesEnrichResult>(
  runtime: CliPriceEnrichmentRuntime,
  options: ExecuteCliPriceEnrichmentRuntimeOptions<TSuccess>
): Promise<Result<TSuccess, Error>> {
  try {
    if (runtime.controller) {
      await runtime.controller.start();
    }

    const result = await runtime.pipeline.execute(options.params, runtime.priceRuntime);

    if (result.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(result.error.message);
        await runtime.controller.stop();
      }
      return err(result.error);
    }

    const successResult = options.afterSuccess
      ? await options.afterSuccess(result.value, runtime)
      : ok(result.value as TSuccess);
    if (successResult.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(successResult.error.message);
        await runtime.controller.stop();
      }
      return err(successResult.error);
    }

    if (runtime.controller) {
      runtime.controller.complete();
      await runtime.controller.stop();
    }

    return ok(successResult.value);
  } catch (error) {
    if (runtime.controller) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.controller.fail(message);
      await runtime.controller.stop().catch((controllerError) => {
        logger.warn({ controllerError }, 'Failed to stop controller after exception');
      });
    }
    return wrapError(error, 'Price enrichment failed');
  }
}

export async function withCliPriceEnrichmentRuntime<T>(
  options: WithCliPriceEnrichmentRuntimeOptions,
  operation: (runtime: CliPriceEnrichmentRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const runtimeResult = await createCliPriceEnrichmentRuntime({
    accountingExclusionPolicy: options.accountingExclusionPolicy,
    database: options.database,
    format: options.format,
    profileId: options.profileId,
    registerCleanup: false,
    scope: options.scope,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const runtime = runtimeResult.value;
  const cleanupPriceRuntime = adaptResultCleanup(runtime.priceRuntime.cleanup);

  options.onAbortRegistered?.(() => {
    if (runtime.controller) {
      runtime.controller.abort();
      void runtime.controller.stop().catch((error) => {
        logger.warn({ error }, 'Failed to stop controller on abort');
      });
    }
  });

  try {
    return await operation(runtime);
  } finally {
    options.onAbortReleased?.();
    await cleanupPriceRuntime().catch((cleanupError) => {
      logger.warn({ cleanupError }, 'Failed to clean up price runtime after price enrichment operation');
    });
  }
}
