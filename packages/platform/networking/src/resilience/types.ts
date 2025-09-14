export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  maxFailures: number;
  recoveryTimeoutMs: number;
}

export interface CircuitBreakerStats {
  failureCount: number;
  lastFailureTimestamp: number;
  lastSuccessTimestamp: number;
  maxFailures: number;
  state: CircuitState;
  timeSinceLastFailureMs: number;
  timeUntilRecoveryMs: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly stats: CircuitBreakerStats,
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
