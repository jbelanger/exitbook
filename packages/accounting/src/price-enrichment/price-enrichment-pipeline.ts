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

import type { KyselyDB } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { InstrumentationCollector, type MetricsSummary } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { PriceProviderManager } from '@exitbook/price-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { PriceDerivationService } from './price-derivation-service.js';
import type { PriceEvent } from './price-events.js';
import { PriceFetchService } from './price-fetch-service.js';
import type { PricesFetchResult } from './price-fetch-utils.js';
import { determineEnrichmentStages } from './price-fetch-utils.js';
import type { NormalizeResult } from './price-normalization-service.js';
import { PriceNormalizationService } from './price-normalization-service.js';
import { StandardFxRateProvider } from './standard-fx-rate-provider.js';

type StageCompletedResult = Extract<PriceEvent, { type: 'stage.completed' }>['result'];
type StageName = Extract<PriceEvent, { type: 'stage.started' }>['stage'];

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
  propagation?: { transactionsUpdated: number } | undefined;

  /** Aggregated API call statistics across stages */
  runStats?: MetricsSummary | undefined;
}

/**
 * Structured error for when --on-missing=fail triggers an abort during normalization.
 * Carries structured data so callers can format their own messages.
 */
export class NormalizeAbortError extends Error {
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
 * Caller is responsible for creating and destroying the PriceProviderManager.
 */
export class PriceEnrichmentPipeline {
  private readonly logger = getLogger('PriceEnrichmentPipeline');
  private readonly instrumentation: InstrumentationCollector;

  constructor(
    private readonly db: KyselyDB,
    private readonly eventBus?: EventBus<PriceEvent>,
    instrumentation?: InstrumentationCollector
  ) {
    this.instrumentation = instrumentation ?? new InstrumentationCollector();
  }

  /**
   * Execute the enrichment pipeline.
   *
   * @param options - Pipeline options
   * @param priceManager - Initialized price provider manager (caller is responsible for lifecycle)
   */
  async execute(
    options: PricesEnrichOptions,
    priceManager: PriceProviderManager
  ): Promise<Result<PricesEnrichResult, Error>> {
    try {
      const stages = determineEnrichmentStages(options);

      this.logger.info(
        { normalize: stages.normalize, derive: stages.derive, fetch: stages.fetch },
        'Enrichment stages enabled'
      );

      const result: PricesEnrichResult = {};

      // Stage 1: Derive (extract from trades: USD + non-USD fiat, propagate via links)
      if (stages.derive) {
        const enrichmentService = new PriceDerivationService(this.db);
        const deriveResult = await this.runStage(
          'Stage 1: Deriving prices from trades (USD + fiat)',
          'tradePrices',
          () => enrichmentService.derivePrices(),
          (value) => ({ stage: 'tradePrices' as const, transactionsUpdated: value.transactionsUpdated })
        );
        if (deriveResult.isErr()) return err(deriveResult.error);
        result.derive = deriveResult.value;
      }

      // Stage 2: Normalize (FX conversion: CAD/EUR → USD)
      if (stages.normalize) {
        const fxRateProvider = new StandardFxRateProvider(priceManager);
        const normalizeService = new PriceNormalizationService(this.db, fxRateProvider);
        const normalizeResult = await this.runStage(
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
        if (normalizeResult.isErr()) return err(normalizeResult.error);
        result.normalize = normalizeResult.value;

        if (options.onMissing === 'fail' && result.normalize.failures > 0) {
          return err(
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
        const fetchService = new PriceFetchService(this.db, this.instrumentation, this.eventBus);
        const fetchResult = await this.runStage(
          'Stage 3: Fetching missing prices from external providers',
          'marketPrices',
          () => fetchService.execute({ asset: options.asset, onMissing: options.onMissing }, priceManager),
          (value) => ({
            stage: 'marketPrices' as const,
            pricesFetched: value.stats.pricesFetched,
            movementsUpdated: value.stats.movementsUpdated,
            skipped: value.stats.skipped,
            failures: value.stats.failures,
            errors: value.errors,
          })
        );
        if (fetchResult.isErr()) return err(fetchResult.error);
        result.fetch = fetchResult.value;
      }

      // Stage 4: Derive (second pass) — use newly fetched/normalized prices
      if (stages.derive && (stages.fetch || stages.normalize)) {
        const enrichmentService = new PriceDerivationService(this.db);
        const propagateResult = await this.runStage(
          'Stage 4: Re-deriving prices using fetched/normalized data',
          'propagation',
          () => enrichmentService.derivePrices(),
          (value) => ({ stage: 'propagation' as const, transactionsUpdated: value.transactionsUpdated })
        );
        if (propagateResult.isErr()) return err(propagateResult.error);
        result.propagation = propagateResult.value;
      }

      this.logger.info('Unified price enrichment pipeline completed');
      result.runStats = this.instrumentation.getSummary();
      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
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
