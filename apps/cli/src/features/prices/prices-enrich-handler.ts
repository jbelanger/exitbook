/**
 * Handler for prices enrich command - orchestrates four-stage enrichment pipeline
 *
 * Stage 1: Derive - Extract prices from trades (USD + non-USD fiat) and propagate via links
 * Stage 2: Normalize - Convert non-USD fiat prices to USD using FX providers
 * Stage 3: Fetch - Fetch missing crypto prices from external providers
 * Stage 4: Derive (2nd pass) - Use newly fetched/normalized prices for ratio calculations
 *
 * Order is critical:
 * - Derive creates initial prices (including fiat-execution-tentative for CAD/EUR trades)
 * - Normalize converts fiat prices to USD and upgrades fiat-execution-tentative → derived-ratio (priority 2)
 * - Fetch fills remaining gaps with provider USD prices (priority 1, cannot overwrite priority 2)
 * - Derive (2nd pass) calculates ratios and propagates prices using fetched/normalized data
 *
 * This stage ordering ensures that execution prices from non-USD fiat trades are preserved
 * and not overwritten by provider prices during fetch.
 *
 * This is the recommended workflow for price enrichment, combining all stages
 * in a single command. Individual stages can be run separately via --normalize-only,
 * --derive-only, or --fetch-only for granular control.
 */

import {
  PriceEnrichmentService,
  PriceNormalizationService,
  StandardFxRateProvider,
  TransactionLinkRepository,
} from '@exitbook/accounting';
import type { IFxRateProvider, NormalizeResult } from '@exitbook/accounting';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { PriceProviderManager } from '@exitbook/price-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { InteractiveFxRateProvider } from './interactive-fx-rate-provider.js';
import { PricesFetchHandler } from './prices-handler.js';
import { createDefaultPriceProviderManager, determineEnrichmentStages } from './prices-utils.js';
import type { PricesFetchResult } from './prices-utils.js';

const logger = getLogger('PricesEnrichHandler');

/**
 * Options for prices enrich command
 */
export interface PricesEnrichOptions {
  /** Filter by specific assets (e.g., ['BTC', 'ETH']) */
  asset?: string[] | undefined;

  /** Enable interactive mode for manual price/FX entry */
  interactive?: boolean | undefined;

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
  derive2?: { transactionsUpdated: number } | undefined;
}

/**
 * Handler for prices enrich command
 */
export class PricesEnrichHandler {
  private transactionRepo: TransactionRepository;
  private linkRepo: TransactionLinkRepository;
  private priceManager: PriceProviderManager | undefined;

  constructor(private db: KyselyDB) {
    this.transactionRepo = new TransactionRepository(db);
    this.linkRepo = new TransactionLinkRepository(db);
  }

  /**
   * Execute prices enrich command
   */
  async execute(options: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    try {
      logger.info('Starting unified price enrichment pipeline');

      // Determine which stages to run
      const stages = determineEnrichmentStages(options);

      logger.info(
        {
          normalize: stages.normalize,
          derive: stages.derive,
          fetch: stages.fetch,
        },
        'Enrichment stages enabled'
      );

      const result: PricesEnrichResult = {};

      // Initialize price provider manager (needed for Stage 2 and Stage 3)
      if (stages.normalize || stages.fetch) {
        const managerResult = await createDefaultPriceProviderManager();

        if (managerResult.isErr()) {
          return err(managerResult.error);
        }

        this.priceManager = managerResult.value;
      }

      // Stage 1: Derive (extract from trades: USD + non-USD fiat, propagate via links)
      if (stages.derive) {
        logger.info('Stage 1: Deriving prices from trades (USD + fiat)');

        const enrichmentService = new PriceEnrichmentService(this.transactionRepo, this.linkRepo);
        const deriveResult = await enrichmentService.enrichPrices();

        if (deriveResult.isErr()) {
          logger.error({ error: deriveResult.error }, 'Stage 1 (derive) failed');
          return err(deriveResult.error);
        }

        result.derive = deriveResult.value;

        logger.info(
          {
            transactionsUpdated: result.derive.transactionsUpdated,
          },
          'Stage 1 (derive) completed'
        );
      }

      // Stage 2: Normalize (FX conversion: CAD/EUR → USD, upgrade fiat-execution-tentative → derived-ratio)
      if (stages.normalize) {
        logger.info('Stage 2: Normalizing non-USD fiat prices to USD');

        if (!this.priceManager) {
          return err(new Error('Price manager not initialized'));
        }

        // Create FX rate provider with appropriate behavior
        const standardProvider = new StandardFxRateProvider(this.priceManager);
        const fxRateProvider: IFxRateProvider = options.interactive
          ? new InteractiveFxRateProvider(standardProvider, true)
          : standardProvider;

        const normalizeService = new PriceNormalizationService(this.transactionRepo, fxRateProvider);
        const normalizeResult = await normalizeService.normalize();

        if (normalizeResult.isErr()) {
          logger.error({ error: normalizeResult.error }, 'Stage 2 (normalize) failed');
          return err(normalizeResult.error);
        }

        result.normalize = normalizeResult.value;

        logger.info(
          {
            normalized: result.normalize.movementsNormalized,
            skipped: result.normalize.movementsSkipped,
            failures: result.normalize.failures,
          },
          'Stage 2 (normalize) completed'
        );
      }

      // Stage 3: Fetch (external providers for remaining crypto prices)
      if (stages.fetch) {
        logger.info('Stage 3: Fetching missing prices from external providers');

        const fetchHandler = new PricesFetchHandler(this.db);
        const fetchResult = await fetchHandler.execute({
          asset: options.asset,
          interactive: options.interactive,
        });

        if (fetchResult.isErr()) {
          logger.error({ error: fetchResult.error }, 'Stage 3 (fetch) failed');
          return err(fetchResult.error);
        }

        result.fetch = fetchResult.value;

        logger.info(
          {
            pricesFetched: result.fetch.stats.pricesFetched,
            movementsUpdated: result.fetch.stats.movementsUpdated,
            failures: result.fetch.stats.failures,
          },
          'Stage 3 (fetch) completed'
        );
      }

      // Stage 4: Derive (second pass) - use newly fetched/normalized prices
      // Run derive again if we ran fetch or normalize (which added new prices)
      if (stages.derive && (stages.fetch || stages.normalize)) {
        logger.info('Stage 4: Re-deriving prices using fetched/normalized data (Pass 1 + Pass N+2)');

        const enrichmentService = new PriceEnrichmentService(this.transactionRepo, this.linkRepo);
        const secondDeriveResult = await enrichmentService.enrichPrices();

        if (secondDeriveResult.isErr()) {
          logger.error({ error: secondDeriveResult.error }, 'Stage 4 (2nd derive) failed');
          return err(secondDeriveResult.error);
        }

        result.derive2 = secondDeriveResult.value;

        logger.info(
          {
            transactionsUpdated: result.derive2.transactionsUpdated,
          },
          'Stage 4 (2nd derive) completed'
        );
      }

      logger.info('Unified price enrichment pipeline completed');
      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    // Price manager cleanup if needed
  }
}
