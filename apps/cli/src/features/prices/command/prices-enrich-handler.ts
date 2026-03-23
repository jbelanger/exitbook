import {
  PriceEnrichmentPipeline,
  type PricingEvent,
  StandardFxRateProvider,
  type PricesEnrichOptions,
  type PricesEnrichResult,
} from '@exitbook/accounting';
import { buildPricingPorts } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { CommandScope } from '../../../runtime/command-scope.js';
import { createEventDrivenController, type EventDrivenController } from '../../../ui/shared/index.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import type { InfrastructureHandler } from '../../shared/handler-contracts.js';
import { PricesEnrichMonitor } from '../view/prices-enrich-components.jsx';

const logger = getLogger('PricesEnrichHandler');

/**
 * Tier 2 handler for `prices enrich`.
 * Factory owns cleanup; command file never calls ctx.onCleanup().
 */
export class PricesEnrichHandler implements InfrastructureHandler<PricesEnrichOptions, PricesEnrichResult> {
  constructor(
    private readonly pipeline: PriceEnrichmentPipeline,
    private readonly priceRuntime: IPriceProviderRuntime,
    private readonly controller: EventDrivenController<PricingEvent> | undefined
  ) {}

  async execute(params: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    try {
      if (this.controller) {
        await this.controller.start();
      }

      const fxRateProvider = new StandardFxRateProvider(this.priceRuntime);
      const result = await this.pipeline.execute(params, this.priceRuntime, fxRateProvider);

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
      return wrapError(error, 'Price enrichment failed');
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
  ctx: CommandScope,
  options: { isJsonMode: boolean }
): Promise<Result<PricesEnrichHandler, Error>> {
  const database = await ctx.database();
  const store = buildPricingPorts(database);
  const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir);
  if (accountingExclusionPolicyResult.isErr()) {
    return err(accountingExclusionPolicyResult.error);
  }
  const accountingExclusionPolicy = accountingExclusionPolicyResult.value;

  if (options.isJsonMode) {
    const instrumentation = new InstrumentationCollector();
    const priceRuntimeResult = await ctx.openPriceProviderRuntime({ instrumentation });
    if (priceRuntimeResult.isErr()) {
      return err(priceRuntimeResult.error);
    }
    const priceRuntime = priceRuntimeResult.value;

    const pipeline = new PriceEnrichmentPipeline(store, undefined, instrumentation, accountingExclusionPolicy);
    return ok(new PricesEnrichHandler(pipeline, priceRuntime, undefined));
  }

  const eventBus = new EventBus<PricingEvent>({
    onError: (busErr) => {
      logger.error({ err: busErr }, 'EventBus error');
    },
  });
  const instrumentation = new InstrumentationCollector();
  const controller = createEventDrivenController(eventBus, PricesEnrichMonitor, { instrumentation });

  const priceRuntimeResult = await ctx.openPriceProviderRuntime({
    instrumentation,
    eventBus,
  });
  if (priceRuntimeResult.isErr()) {
    controller.fail(priceRuntimeResult.error.message);
    await controller.stop();
    return err(priceRuntimeResult.error);
  }
  const priceRuntime = priceRuntimeResult.value;

  const pipeline = new PriceEnrichmentPipeline(store, eventBus, instrumentation, accountingExclusionPolicy);
  return ok(new PricesEnrichHandler(pipeline, priceRuntime, controller));
}
