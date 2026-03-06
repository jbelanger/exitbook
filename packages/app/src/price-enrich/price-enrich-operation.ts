import {
  PriceEnrichmentPipeline,
  StandardFxRateProvider,
  type IPricingPersistence,
  type PriceEvent,
  type PricesEnrichOptions,
  type PricesEnrichResult,
} from '@exitbook/accounting';
import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';
import type { PriceProviderManager } from '@exitbook/price-providers';

import { PricingStoreAdapter } from './pricing-store-adapter.js';

export type { PricesEnrichOptions, PricesEnrichResult };

/**
 * App-layer operation for price enrichment.
 * Constructs the adapter and FX rate provider, then delegates to PriceEnrichmentPipeline.
 */
export class PriceEnrichOperation {
  private readonly store: IPricingPersistence;

  constructor(
    db: DataContext,
    private readonly priceManager: PriceProviderManager,
    private readonly eventBus?: EventBus<PriceEvent> | undefined,
    private readonly instrumentation?: InstrumentationCollector | undefined
  ) {
    this.store = new PricingStoreAdapter(db);
  }

  async execute(options: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    const fxRateProvider = new StandardFxRateProvider(this.priceManager);
    const pipeline = new PriceEnrichmentPipeline(this.store, this.eventBus, this.instrumentation);

    return pipeline.execute(options, this.priceManager, fxRateProvider);
  }
}
