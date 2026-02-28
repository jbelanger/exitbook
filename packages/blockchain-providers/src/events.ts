/**
 * Events emitted by blockchain provider operations.
 * Used for CLI progress display and observability.
 */

export type ProviderEvent =
  // Request lifecycle (verbose, emitted by HttpClient hooks)
  | {
      /**
       * Emitted when an HTTP request starts.
       * Used for verbose observability; not currently surfaced in CLI UI.
       */
      blockchain: string;
      endpoint: string;
      method: string;
      provider: string;
      type: 'provider.request.started';
    }
  | {
      /**
       * Emitted when an HTTP request completes successfully.
       * Used for verbose observability; not currently surfaced in CLI UI.
       */
      blockchain: string;
      durationMs: number;
      endpoint: string;
      method: string;
      provider: string;
      status: number;
      type: 'provider.request.succeeded';
    }
  | {
      /**
       * Emitted when an HTTP request fails.
       * Used for verbose observability; not currently surfaced in CLI UI.
       */
      blockchain: string;
      durationMs: number;
      endpoint: string;
      error: string;
      method: string;
      provider: string;
      status?: number | undefined;
      type: 'provider.request.failed';
    }
  // Provider selection & switching
  | {
      /**
       * Emitted when a provider is selected for an operation.
       * Used by CLI dashboard activity log.
       */
      blockchain: string;
      operation: string;
      providers: { name: string; reason: string; score: number }[];
      selected: string;
      type: 'provider.selection';
    }
  | {
      /**
       * Emitted when resuming from an existing cursor with a provider.
       * Used by CLI dashboard activity log.
       */
      blockchain: string;
      cursor: number | string;
      cursorType: string; // e.g., 'blockNumber', 'timestamp', 'slot', etc.
      operation: string;
      provider: string;
      streamType?: string | undefined; // For getAddressTransactions: 'normal', 'internal', 'token', 'beacon_withdrawal', etc.
      type: 'provider.resume';
    }
  | {
      /**
       * Emitted when replay window adjusts a cursor during failover.
       * Currently not surfaced in UI (reserved for observability).
       */
      adjustedCursor: number | string;
      blockchain: string;
      cursorType: string; // e.g., 'blockNumber', 'timestamp', 'slot', etc.
      originalCursor: number | string;
      provider: string;
      reason: 'replay_window' | 'failover';
      type: 'provider.cursor.adjusted';
    }
  | {
      /**
       * Emitted when switching from a failed provider to a backup.
       * Used by CLI dashboard activity log.
       */
      blockchain: string;
      from: string;
      operation: string;
      reason: string;
      streamType?: string | undefined; // For getAddressTransactions: 'normal', 'internal', 'token', 'beacon_withdrawal', etc.
      to: string;
      type: 'provider.failover';
    }
  // Error handling & resilience
  | {
      /**
       * Emitted when a provider returns 429 or rate limit error.
       * Used by CLI dashboard to track throttle counts and display warnings.
       */
      blockchain: string;
      provider: string;
      retryAfterMs?: number | undefined;
      type: 'provider.rate_limited';
    }
  | {
      /**
       * Emitted when a circuit breaker opens due to repeated failures.
       * Used by CLI dashboard activity log to surface provider health issues.
       */
      blockchain: string;
      provider: string;
      reason: string;
      type: 'provider.circuit_open';
    }
  | {
      /**
       * Emitted when a provider request is delayed due to backoff strategy.
       * Currently not surfaced in UI (reserved for observability).
       */
      attemptNumber: number;
      blockchain: string;
      delayMs: number;
      provider: string;
      type: 'provider.backoff';
    }
  // Token metadata cache
  | {
      batchSize: number;
      blockchain: string;
      cacheHits: number;
      cacheMisses: number;
      durationMs: number;
      /**
       * Emitted when a batch token metadata lookup completes (cache + fetch).
       * Used for CLI progress display and observability.
       */
      type: 'provider.metadata.batch.completed';
    };
