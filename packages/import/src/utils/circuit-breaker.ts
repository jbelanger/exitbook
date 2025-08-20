// Circuit breaker implementation for provider resilience
// Prevents hammering failed providers and enables automatic recovery

import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private readonly maxFailures: number;
  private readonly timeout: number; // Recovery timeout in milliseconds
  private readonly name: string;
  private readonly logger: Logger;
  private lastState: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    name: string,
    maxFailures: number = 3,
    timeoutMs: number = 5 * 60 * 1000 // Default 5 minutes in milliseconds
  ) {
    this.name = name;
    this.maxFailures = maxFailures;
    this.timeout = timeoutMs;
    this.logger = getLogger(`CircuitBreaker:${name}`);

    this.logger.debug(`Circuit breaker initialized`);
  }

  /**
   * Check if the circuit breaker is open (blocking requests)
   */
  isOpen(): boolean {
    if (this.failures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      return timeSinceLastFailure < this.timeout;
    }
    return false;
  }

  /**
   * Check if the circuit breaker is half-open (allowing test requests)
   */
  isHalfOpen(): boolean {
    if (this.failures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      return timeSinceLastFailure >= this.timeout;
    }
    return false;
  }

  /**
   * Check if the circuit breaker is closed (normal operation)
   */
  isClosed(): boolean {
    return this.failures < this.maxFailures;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    const wasOpen = this.isOpen();
    this.failures = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = Date.now();

    const currentState = this.getState();
    if (this.lastState !== currentState) {
      this.logger.info(`Circuit breaker state changed: ${this.lastState} → ${currentState} - Reason: ${'success_recorded'}, Stats: ${this.getStats()}`);
      this.lastState = currentState;
    } else if (wasOpen) {
      this.logger.info(`Circuit breaker recovered after success - Stats: ${this.getStats()}`);
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    const currentState = this.getState();
    if (this.lastState !== currentState) {
      this.logger.warn(`Circuit breaker state changed: ${this.lastState} → ${currentState} - Reason: ${'failure_recorded'}, FailureCount: ${this.failures}, MaxFailures: ${this.maxFailures}, Stats: ${this.getStats()}`);
      this.lastState = currentState;
    } else if (currentState === 'open') {
      this.logger.debug(`Circuit breaker failure recorded while open - FailureCount: ${this.failures}, MaxFailures: ${this.maxFailures}`);
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): 'closed' | 'open' | 'half-open' {
    if (this.failures < this.maxFailures) return 'closed';

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure >= this.timeout) return 'half-open';

    return 'open';
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failures,
      maxFailures: this.maxFailures,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      timeSinceLastFailure: this.lastFailureTime ? Date.now() - this.lastFailureTime : 0,
      timeUntilRecovery: this.isOpen() ? this.timeout - (Date.now() - this.lastFailureTime) : 0
    };
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = 0;
  }
}