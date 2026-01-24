/**
 * Events emitted by blockchain provider operations.
 * Used for CLI progress display and observability.
 */

export type ProviderEvent =
  // Request lifecycle (verbose-only)
  | {
      blockchain: string;
      endpoint: string;
      method: string;
      provider: string;
      type: 'provider.request.started';
    }
  | {
      blockchain: string;
      durationMs: number;
      endpoint: string;
      method: string;
      provider: string;
      status: number;
      type: 'provider.request.succeeded';
    }
  | {
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
      blockchain: string;
      operation: string;
      providers: { name: string; reason: string; score: number; }[];
      selected: string;
      type: 'provider.selection';
    }
  | {
      blockchain: string;
      cursor: number | string;
      cursorType: string; // e.g., 'blockNumber', 'timestamp', 'slot', etc.
      operation: string;
      provider: string;
      type: 'provider.resume';
    }
  | {
      adjustedCursor: number | string;
      blockchain: string;
      cursorType: string; // e.g., 'blockNumber', 'timestamp', 'slot', etc.
      originalCursor: number | string;
      provider: string;
      reason: 'replay_window' | 'failover';
      type: 'provider.cursor.adjusted';
    }
  | {
      blockchain: string;
      from: string;
      reason: string;
      to: string;
      type: 'provider.failover';
    }
  // Error handling & resilience
  | {
      blockchain: string;
      provider: string;
      retryAfterMs?: number | undefined;
      type: 'provider.rate_limited';
    }
  | {
      blockchain: string;
      provider: string;
      reason: string;
      type: 'provider.circuit_open';
    }
  | {
      attemptNumber: number;
      blockchain: string;
      delayMs: number;
      provider: string;
      type: 'provider.backoff';
    };
