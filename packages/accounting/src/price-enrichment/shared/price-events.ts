import type { PriceProviderEvent } from '@exitbook/price-providers';

/**
 * Events emitted during pricing workflows.
 * Includes provider lifecycle events and price enrichment stage events.
 */

export type PricingStageEvent =
  | {
      /**
       * Emitted when an enrichment stage begins.
       */
      stage: 'tradePrices' | 'fxRates' | 'marketPrices' | 'rederive';
      type: 'stage.started';
    }
  | {
      /**
       * Emitted when a stage completes successfully.
       */
      result:
        | { stage: 'tradePrices'; transactionsUpdated: number }
        | {
            errors: string[];
            failures: number;
            movementsNormalized: number;
            movementsSkipped: number;
            stage: 'fxRates';
          }
        | {
            errors: string[];
            failures: number;
            movementsUpdated: number;
            pricesFetched: number;
            skipped: number;
            stage: 'marketPrices';
          }
        | { stage: 'rederive'; transactionsUpdated: number };
      type: 'stage.completed';
    }
  | {
      /**
       * Emitted when a stage encounters an error.
       */
      error: string;
      stage: string;
      type: 'stage.failed';
    }
  | {
      /**
       * Emitted periodically during market prices stage with progress.
       */
      processed: number;
      stage: 'marketPrices';
      total: number;
      type: 'stage.progress';
    };

export type PricingEvent = PriceProviderEvent | PricingStageEvent;
