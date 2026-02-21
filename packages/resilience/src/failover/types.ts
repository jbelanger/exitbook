import type { Logger } from '@exitbook/logger';
import type { Result } from 'neverthrow';

import type { CircuitState, CircuitStatus } from '../circuit-breaker/types.js';
import type { IProvider } from '../provider-health/types.js';

/** Structured record of a single failover attempt for diagnostics */
export interface FailoverAttempt {
  providerName: string;
  durationMs: number;
  error?: string | undefined;
  circuitTransition?: { from: CircuitStatus; to: CircuitStatus } | undefined;
  blockReason?: 'circuit_open' | undefined;
}

/**
 * Configuration for the generic failover executor
 *
 * Callbacks for side effects (onSuccess, onFailure) keep the executor decoupled
 * from storage and eventing concerns. Each caller wires a few lines of callback code.
 */
export interface FailoverOptions<TProvider extends IProvider, TResult, TError extends Error = Error> {
  /** Ordered providers to attempt (highest-priority first) */
  providers: readonly TProvider[];

  /** Execute the operation against a single provider. Signal is provided when timeout/cancellation is configured. */
  execute: (provider: TProvider, signal?: AbortSignal) => Promise<Result<TResult, Error>>;

  /** Circuit breaker registry for state lookups and recording */
  circuitBreakers: import('../circuit-breaker/registry.js').CircuitBreakerRegistry;

  /** Label for log messages (e.g., 'fetchPrice', 'getBalance') */
  operationLabel: string;

  /** Logger instance */
  logger: Logger;

  /**
   * Resolve circuit breaker key for a provider.
   * Default: `provider.name`
   * Override for composite keys like `"blockchain/provider"`
   */
  getCircuitKey?: ((provider: TProvider) => string) | undefined;

  /**
   * Determine if an error is "recoverable" (e.g., coin-not-found, data-unavailable).
   * Recoverable errors do NOT trigger circuit breaker failure recording.
   * Default: `() => false` (all errors count)
   */
  isRecoverableError?: ((error: Error) => boolean) | undefined;

  /** Called after a successful provider execution */
  onSuccess?: ((provider: TProvider, responseTime: number) => void) | undefined;

  /** Called after a failed provider execution (previousCircuitState is the state before failure recording) */
  onFailure?:
    | ((
        provider: TProvider,
        error: Error,
        responseTime: number,
        previousCircuitState: CircuitState,
        newCircuitState: CircuitState
      ) => void)
    | undefined;

  /**
   * Build the final error when all providers fail.
   * Default: plain `Error` with a summary message.
   */
  buildFinalError?:
    | ((
        lastError: Error | undefined,
        attemptedProviders: string[],
        allRecoverable: boolean,
        attempts: FailoverAttempt[]
      ) => TError)
    | undefined;

  /** Caller-driven cancellation signal. Checked before each attempt. */
  signal?: AbortSignal | undefined;

  /** Per-provider attempt timeout in milliseconds. Wraps execute() with AbortSignal.timeout(). */
  perAttemptTimeoutMs?: number | undefined;

  /** Total wall-clock timeout across all attempts in milliseconds. */
  totalTimeoutMs?: number | undefined;
}

/**
 * Result from a successful failover execution
 */
export interface FailoverResult<T> {
  data: T;
  providerName: string;
}
