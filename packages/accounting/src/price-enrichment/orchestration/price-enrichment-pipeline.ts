/**
 * Four-stage price enrichment pipeline:
 *
 * Stage 1: Derive - Extract prices from trades (USD + non-USD fiat) and propagate via links
 * Stage 2: Normalize - Convert non-USD fiat prices to USD using FX providers
 * Stage 3: Fetch - Fetch missing crypto prices from external providers
 * Stage 4: Derive (2nd pass) - Use newly fetched/normalized prices for ratio calculations
 *
 * Order is critical:
 * - Derive creates initial prices (including fiat-execution-tentative for CAD/EUR trades)
 * - Normalize converts fiat prices to USD (upgrades fiat-execution-tentative → derived-ratio, priority 2)
 * - Fetch fills remaining gaps with provider USD prices (priority 1, cannot overwrite priority 2)
 * - Derive (2nd pass) calculates ratios and propagates prices using fetched/normalized data
 */

import type { Result } from '@exitbook/core';
import { err, ok, resultTryAsync } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector, type MetricsSummary } from '@exitbook/observability';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { AccountingExclusionPolicy } from '../../cost-basis/standard/validation/accounting-exclusion-policy.js';
import type { IPricingPersistence } from '../../ports/pricing-persistence.js';
import type { PricesFetchResult } from '../enrichment/price-fetch-utils.js';
import { determineEnrichmentStages } from '../enrichment/price-fetch-utils.js';
import type { PricingEvent } from '../shared/price-events.js';
import type { IFxRateProvider } from '../shared/types.js';

import { PriceFetchService } from './price-fetch-service.js';
import { PriceInferenceService } from './price-inference-service.js';
import type { NormalizeResult } from './price-normalization-service.js';
import { PriceNormalizationService } from './price-normalization-service.js';

type StageCompletedResult = Extract<PricingEvent, { type: 'stage.completed' }>['result'];
type StageName = Extract<PricingEvent, { type: 'stage.started' }>['stage'];

/**
 * Options for the price enrichment pipeline
 */
export interface PricesEnrichOptions {
  /** Filter by specific assets (e.g., ['BTC', 'ETH']) */
  asset?: string[] | undefined;

  /** How to handle missing prices/FX rates */
  onMissing?: 'fail' | undefined;

  /** Only run normalization stage (FX conversion) */
  normalizeOnly?: boolean | undefined;

  /** Only run derivation stage (extract from USD trades) */
  deriveOnly?: boolean | undefined;

  /** Only run fetch stage (external providers) */
  fetchOnly?: boolean | undefined;
}

/**
 * Result of the complete enrichment pipeline
 */
export interface PricesEnrichResult {
  /** Stage 1 results (derivation - first pass) */
  derive?: { transactionsUpdated: number } | undefined;

  /** Stage 2 results (normalization - FX conversion) */
  normalize?: NormalizeResult | undefined;

  /** Stage 3 results (fetch from providers) */
  fetch?: PricesFetchResult | undefined;

  /** Stage 4 results (derivation - second pass) */
  rederive?: { transactionsUpdated: number } | undefined;

  /** Aggregated API call statistics across stages */
  runStats?: MetricsSummary | undefined;
}

/**
 * Structured error for when --on-missing=fail triggers an abort during normalization.
 * Carries structured data so callers can format their own messages.
 */
class NormalizeAbortError extends Error {
  constructor(
    public readonly failures: number,
    public readonly errors: string[],
    public readonly movementsNormalized: number,
    public readonly movementsSkipped: number
  ) {
    super(`${failures} FX rate conversion failure(s) in normalization stage`);
    this.name = 'NormalizeAbortError';
  }
}

/**
 * Orchestrates the four-stage price enrichment pipeline.
 * Caller is responsible for creating and destroying the underlying host runtime.
 */
export class PriceEnrichmentPipeline {
  private readonly logger = getLogger('PriceEnrichmentPipeline');
  private readonly instrumentation: InstrumentationCollector;
  private readonly inferenceService: PriceInferenceService;
  private readonly fetchService: PriceFetchService;

  constructor(
    private readonly store: IPricingPersistence,
    private readonly eventBus?: EventBus<PricingEvent>,
    instrumentation?: InstrumentationCollector,
    private readonly accountingExclusionPolicy?: AccountingExclusionPolicy,
    inferenceService?: PriceInferenceService,
    fetchService?: PriceFetchService
  ) {
    this.instrumentation = instrumentation ?? new InstrumentationCollector();
    this.inferenceService = inferenceService ?? new PriceInferenceService(this.store);
    this.fetchService =
      fetchService ??
      new PriceFetchService(this.store, this.instrumentation, this.eventBus, this.accountingExclusionPolicy);
  }

  /**
   * Execute the enrichment pipeline.
   *
   * @param options - Pipeline options
   * @param priceRuntime - Price provider runtime for external price lookups
   * @param fxRateProvider - FX rate provider for normalization stage
   */
  async execute(
    options: PricesEnrichOptions,
    priceRuntime: IPriceProviderRuntime,
    fxRateProvider: IFxRateProvider
  ): Promise<Result<PricesEnrichResult, Error>> {
    return resultTryAsync(
      async function* (self) {
        const stages = determineEnrichmentStages(options);

        self.logger.info(
          { normalize: stages.normalize, derive: stages.derive, fetch: stages.fetch },
          'Enrichment stages enabled'
        );

        const result: PricesEnrichResult = {};

        // Stage 1: Derive (extract from trades: USD + non-USD fiat, propagate via links)
        if (stages.derive) {
          result.derive = yield* await self.runStage(
            'Stage 1: Deriving prices from trades (USD + fiat)',
            'tradePrices',
            () => self.inferenceService.derivePrices(),
            (value) => ({ stage: 'tradePrices' as const, transactionsUpdated: value.transactionsUpdated })
          );
        }

        // Stage 2: Normalize (FX conversion: CAD/EUR → USD)
        if (stages.normalize) {
          const normalizeService = new PriceNormalizationService(self.store, fxRateProvider);
          result.normalize = yield* await self.runStage(
            'Stage 2: Normalizing non-USD fiat prices to USD',
            'fxRates',
            () => normalizeService.normalize(),
            (value) => ({
              stage: 'fxRates' as const,
              movementsNormalized: value.movementsNormalized,
              movementsSkipped: value.movementsSkipped,
              failures: value.failures,
              errors: value.errors,
            })
          );

          if (options.onMissing === 'fail' && result.normalize.failures > 0) {
            yield* err(
              new NormalizeAbortError(
                result.normalize.failures,
                result.normalize.errors,
                result.normalize.movementsNormalized,
                result.normalize.movementsSkipped
              )
            );
          }
        }

        // Stage 3: Fetch (external providers for remaining crypto prices)
        if (stages.fetch) {
          result.fetch = yield* await self.runStage(
            'Stage 3: Fetching missing prices from external providers',
            'marketPrices',
            () => self.fetchService.fetchPrices({ asset: options.asset, onMissing: options.onMissing }, priceRuntime),
            (value) => ({
              stage: 'marketPrices' as const,
              pricesFetched: value.stats.pricesFetched,
              movementsUpdated: value.stats.movementsUpdated,
              skipped: value.stats.skipped,
              failures: value.stats.failures,
              errors: value.errors,
            })
          );
        }

        // Stage 4: Derive (second pass) — use newly fetched/normalized prices
        if (stages.derive && (stages.fetch || stages.normalize)) {
          result.rederive = yield* await self.runStage(
            'Stage 4: Re-deriving prices using fetched/normalized data',
            'rederive',
            () => self.inferenceService.derivePrices(),
            (value) => ({ stage: 'rederive' as const, transactionsUpdated: value.transactionsUpdated })
          );
        }

        self.logger.info('Unified price enrichment pipeline completed');
        result.runStats = self.instrumentation.getSummary();
        return result;
      },
      this,
      (error) => (error instanceof Error ? error : new Error(String(error)))
    );
  }

  /**
   * Run a single pipeline stage with event lifecycle management.
   *
   * Emits stage.started, runs the executor, then emits stage.completed or stage.failed.
   */
  private async runStage<T>(
    description: string,
    stageName: StageName,
    fn: () => Promise<Result<T, Error>>,
    buildCompletedEvent: (value: T) => StageCompletedResult
  ): Promise<Result<T, Error>> {
    this.logger.info(description);
    this.eventBus?.emit({ type: 'stage.started', stage: stageName });

    const result = await fn();

    if (result.isErr()) {
      this.logger.error({ error: result.error }, `${stageName} failed`);
      this.eventBus?.emit({ type: 'stage.failed', stage: stageName, error: result.error.message });
      return err(result.error);
    }

    this.eventBus?.emit({ type: 'stage.completed', result: buildCompletedEvent(result.value) });
    return ok(result.value);
  }
}
