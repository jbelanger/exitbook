import {
  PriceEnrichmentPipeline,
  StandardFxRateProvider,
  type PriceEvent,
  type PricesEnrichOptions,
  type PricesEnrichResult,
} from '@exitbook/accounting';
import type { DataContext } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';
import type { PriceProviderManager } from '@exitbook/price-providers';
import type { Result } from 'neverthrow';

import { PricingStoreAdapter } from './pricing-store-adapter.js';

export type { PricesEnrichOptions, PricesEnrichResult };

/**
 * App-layer operation for price enrichment.
 * Constructs the adapter and FX rate provider, then delegates to PriceEnrichmentPipeline.
 */
export class PriceEnrichOperation {
  constructor(
    private readonly db: DataContext,
    private readonly priceManager: PriceProviderManager,
    private readonly eventBus?: EventBus<PriceEvent> | undefined,
    private readonly instrumentation?: InstrumentationCollector | undefined
  ) {}

  async execute(options: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    const store = new PricingStoreAdapter(this.db);
    const fxRateProvider = new StandardFxRateProvider(this.priceManager);
    const pipeline = new PriceEnrichmentPipeline(store, this.eventBus, this.instrumentation);

    return pipeline.execute(options, this.priceManager, fxRateProvider);
  }
}
