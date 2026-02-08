/**
 * Events emitted by price enrichment operations.
 * Used for CLI progress display and UI decoupling.
 */

import type { PriceProviderEvent } from '@exitbook/price-providers';

export type PriceEvent =
  // Provider lifecycle events (from @exitbook/price-providers)
  | PriceProviderEvent
  // Stage lifecycle events
  | {
      /**
       * Emitted when an enrichment stage begins.
       * Used by CLI dashboard to show stage progress.
       */
      stage: 'tradePrices' | 'fxRates' | 'marketPrices' | 'propagation';
      type: 'stage.started';
    }
  | {
      /**
       * Emitted when a stage completes successfully.
       * Used by CLI dashboard to show stage results.
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
        | { stage: 'propagation'; transactionsUpdated: number };
      type: 'stage.completed';
    }
  | {
      /**
       * Emitted when a stage encounters an error.
       * Used by CLI dashboard activity log.
       */
      error: string;
      stage: string;
      type: 'stage.failed';
    }
  | {
      /**
       * Emitted periodically during market prices stage with progress.
       * Used by CLI dashboard to update progress counters.
       */
      processed: number;
      stage: 'marketPrices';
      total: number;
      type: 'stage.progress';
    };
