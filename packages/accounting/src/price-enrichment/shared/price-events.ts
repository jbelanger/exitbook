/**
 * Events emitted by price enrichment operations.
 * Used for CLI progress display and UI decoupling.
 */

export type PriceEvent =
  // Provider lifecycle events (mirrored from @exitbook/price-providers to avoid cross-package coupling)
  | { type: 'providers.initializing' }
  | { providerCount: number; type: 'providers.ready'; }
  // Stage lifecycle events
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
