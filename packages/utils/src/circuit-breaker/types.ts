/**
 * Circuit breaker state (immutable)
 */
export interface CircuitState {
  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  maxFailures: number;
  recoveryTimeoutMs: number;
}

/**
 * Circuit breaker states
 */
export type CircuitStatus = 'closed' | 'open' | 'half-open';

export const createInitialCircuitState = (maxFailures = 3, recoveryTimeoutMs = 300_000): CircuitState => ({
  failureCount: 0,
  lastFailureTime: 0,
  lastSuccessTime: 0,
  maxFailures,
  recoveryTimeoutMs,
});
