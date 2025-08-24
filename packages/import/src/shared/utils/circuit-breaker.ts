// Circuit breaker implementation for provider resilience
// Prevents hammering failed providers and enables automatic recovery
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTimestamp = 0;
  private lastSuccessTimestamp = 0;
  private readonly maxFailures: number;
  private readonly recoveryTimeoutMs: number;
  private readonly providerName: string;
  private readonly logger: Logger;
  private previousState: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    providerName: string,
    maxFailures: number = 3,
    recoveryTimeoutMs: number = 5 * 60 * 1000 // Default 5 minutes
  ) {
    this.providerName = providerName;
    this.maxFailures = maxFailures;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.logger = getLogger(`CircuitBreaker:${providerName}`);

    this.logger.debug(`Circuit breaker initialized for ${providerName}`);
  }

  /**
   * Determines if circuit breaker is open (blocking all requests)
   */
  isOpen(): boolean {
    if (this.failureCount >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTimestamp;
      return timeSinceLastFailure < this.recoveryTimeoutMs;
    }
    return false;
  }

  /**
   * Determines if circuit breaker is half-open (allowing test requests)
   */
  isHalfOpen(): boolean {
    if (this.failureCount >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTimestamp;
      return timeSinceLastFailure >= this.recoveryTimeoutMs;
    }
    return false;
  }

  /**
   * Determines if circuit breaker is closed (normal operation)
   */
  isClosed(): boolean {
    return this.failureCount < this.maxFailures;
  }

  /**
   * Records successful operation and resets failure state
   */
  recordSuccess(): void {
    const wasOpen = this.isOpen();
    this.failureCount = 0;
    this.lastFailureTimestamp = 0;
    this.lastSuccessTimestamp = Date.now();

    const currentState = this.getCurrentState();
    if (this.previousState !== currentState) {
      this.logger.info(
        `Circuit breaker state changed: ${this.previousState} → ${currentState} - Reason: success_recorded, Stats: ${JSON.stringify(this.getStatistics())}`
      );
      this.previousState = currentState;
    } else if (wasOpen) {
      this.logger.info(`Circuit breaker recovered after success - Stats: ${JSON.stringify(this.getStatistics())}`);
    }
  }

  /**
   * Records failed operation and updates failure state
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTimestamp = Date.now();

    const currentState = this.getCurrentState();
    if (this.previousState !== currentState) {
      this.logger.warn(
        `Circuit breaker state changed: ${this.previousState} → ${currentState} - Reason: failure_recorded, FailureCount: ${this.failureCount}, MaxFailures: ${this.maxFailures}, Stats: ${JSON.stringify(this.getStatistics())}`
      );
      this.previousState = currentState;
    } else if (currentState === 'open') {
      this.logger.debug(
        `Circuit breaker failure recorded while open - FailureCount: ${this.failureCount}, MaxFailures: ${this.maxFailures}`
      );
    }
  }

  /**
   * Returns current circuit breaker state
   */
  getCurrentState(): 'closed' | 'open' | 'half-open' {
    if (this.failureCount < this.maxFailures) return 'closed';

    const timeSinceLastFailure = Date.now() - this.lastFailureTimestamp;
    if (timeSinceLastFailure >= this.recoveryTimeoutMs) return 'half-open';

    return 'open';
  }

  /**
   * Returns comprehensive circuit breaker statistics
   */
  getStatistics() {
    return {
      providerName: this.providerName,
      state: this.getCurrentState(),
      failureCount: this.failureCount,
      maxFailures: this.maxFailures,
      lastFailureTimestamp: this.lastFailureTimestamp,
      lastSuccessTimestamp: this.lastSuccessTimestamp,
      timeSinceLastFailureMs: this.lastFailureTimestamp ? Date.now() - this.lastFailureTimestamp : 0,
      timeUntilRecoveryMs: this.isOpen() ? this.recoveryTimeoutMs - (Date.now() - this.lastFailureTimestamp) : 0,
    };
  }

  /**
   * Resets circuit breaker to closed state (clears all failure history)
   */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTimestamp = 0;
    this.lastSuccessTimestamp = 0;
    this.previousState = 'closed';
    this.logger.info(`Circuit breaker manually reset for ${this.providerName}`);
  }
}
