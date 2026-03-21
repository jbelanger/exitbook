/**
 * Events emitted by price provider operations.
 * Used for CLI progress display and observability.
 */

export type PriceProviderEvent =
  | {
      /** Emitted before provider initialization (coin list sync, database setup, etc.). */
      type: 'providers.initializing';
    }
  | {
      /** Emitted after all price providers are ready. */
      providerCount: number;
      type: 'providers.ready';
    };
