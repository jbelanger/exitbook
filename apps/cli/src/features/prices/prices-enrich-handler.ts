/**
 * Handler for prices enrich command - orchestrates three-stage enrichment pipeline
 *
 * Stage 1: Normalize - Convert non-USD fiat prices to USD using FX providers
 * Stage 2: Derive - Extract prices from USD trades and propagate via links
 * Stage 3: Fetch - Fetch missing crypto prices from external providers
 *
 * This is the recommended workflow for price enrichment, combining all stages
 * in a single command. Individual stages can be run separately via --normalize-only,
 * --derive-only, or --fetch-only for granular control.
 */

import { PriceEnrichmentService, PriceNormalizationService, TransactionLinkRepository } from '@exitbook/accounting';
import type { NormalizeResult } from '@exitbook/accounting';
import { TransactionRepository } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { createPriceProviderManager } from '@exitbook/platform-price-providers';
import type { PriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { PricesFetchHandler } from './prices-handler.ts';
import type { PricesFetchResult } from './prices-utils.ts';

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
  /** Stage 1 results (normalization) */
  normalize?: NormalizeResult | undefined;

  /** Stage 2 results (derivation) */
  derive?: { transactionsUpdated: number } | undefined;

  /** Stage 3 results (fetch) */
  fetch?: PricesFetchResult | undefined;
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
      const stages = {
        normalize: !options.deriveOnly && !options.fetchOnly,
        derive: !options.normalizeOnly && !options.fetchOnly,
        fetch: !options.normalizeOnly && !options.deriveOnly,
      };

      logger.info(
        {
          normalize: stages.normalize,
          derive: stages.derive,
          fetch: stages.fetch,
        },
        'Enrichment stages enabled'
      );

      const result: PricesEnrichResult = {};

      // Initialize price provider manager (needed for Stage 1 and Stage 3)
      if (stages.normalize || stages.fetch) {
        const managerResult = await createPriceProviderManager({
          providers: {
            databasePath: './data/prices.db',
            coingecko: {
              enabled: true,
              apiKey: process.env.COINGECKO_API_KEY,
              useProApi: process.env.COINGECKO_USE_PRO_API === 'true',
            },
            cryptocompare: {
              enabled: true,
              apiKey: process.env.CRYPTOCOMPARE_API_KEY,
            },
            ecb: {
              enabled: true,
            },
            'bank-of-canada': {
              enabled: true,
            },
            frankfurter: {
              enabled: true,
            },
          },
          manager: {
            defaultCurrency: 'USD',
            maxConsecutiveFailures: 3,
            cacheTtlSeconds: 3600,
          },
        });

        if (managerResult.isErr()) {
          return err(managerResult.error);
        }

        this.priceManager = managerResult.value;
      }

      // Stage 1: Normalize (FX conversion: EUR/CAD → USD)
      if (stages.normalize) {
        logger.info('Stage 1: Normalizing non-USD fiat prices to USD');

        if (!this.priceManager) {
          return err(new Error('Price manager not initialized'));
        }

        const normalizeService = new PriceNormalizationService(this.transactionRepo, this.priceManager);
        const normalizeResult = await normalizeService.normalize(
          options.interactive !== undefined ? { interactive: options.interactive } : undefined
        );

        if (normalizeResult.isErr()) {
          logger.error({ error: normalizeResult.error }, 'Stage 1 (normalize) failed');
          return err(normalizeResult.error);
        }

        result.normalize = normalizeResult.value;

        logger.info(
          {
            normalized: result.normalize.movementsNormalized,
            skipped: result.normalize.movementsSkipped,
            failures: result.normalize.failures,
          },
          'Stage 1 (normalize) completed'
        );
      }

      // Stage 2: Derive (extract from USD trades, propagate via links)
      if (stages.derive) {
        logger.info('Stage 2: Deriving prices from USD trades');

        const enrichmentService = new PriceEnrichmentService(this.transactionRepo, this.linkRepo);
        const deriveResult = await enrichmentService.enrichPrices();

        if (deriveResult.isErr()) {
          logger.error({ error: deriveResult.error }, 'Stage 2 (derive) failed');
          return err(deriveResult.error);
        }

        result.derive = deriveResult.value;

        logger.info(
          {
            transactionsUpdated: result.derive.transactionsUpdated,
          },
          'Stage 2 (derive) completed'
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
