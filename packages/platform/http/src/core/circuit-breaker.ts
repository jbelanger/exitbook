// Pure circuit breaker functions
// All functions are pure - they take state and return new state without side effects

import type { CircuitState, CircuitStatus } from './types.js';

/**
 * Get current circuit breaker status
 */
export const getCircuitStatus = (state: CircuitState, currentTime: number): CircuitStatus => {
  if (state.failureCount < state.maxFailures) {
    return 'closed';
  }

  const timeSinceLastFailure = currentTime - state.lastFailureTime;
  if (timeSinceLastFailure >= state.recoveryTimeoutMs) {
    return 'half-open';
  }

  return 'open';
};

/**
 * Check if circuit breaker should block requests
 */
export const shouldCircuitBlock = (state: CircuitState, currentTime: number): boolean => {
  return getCircuitStatus(state, currentTime) === 'open';
};

/**
 * Check if circuit is closed (normal operation)
 */
export const isCircuitClosed = (state: CircuitState): boolean => {
  return state.failureCount < state.maxFailures;
};

/**
 * Check if circuit is half-open (testing recovery)
 */
export const isCircuitHalfOpen = (state: CircuitState, currentTime: number): boolean => {
  if (state.failureCount >= state.maxFailures) {
    const timeSinceLastFailure = currentTime - state.lastFailureTime;
    return timeSinceLastFailure >= state.recoveryTimeoutMs;
  }
  return false;
};

/**
 * Check if circuit is open (blocking requests)
 */
export const isCircuitOpen = (state: CircuitState, currentTime: number): boolean => {
  if (state.failureCount >= state.maxFailures) {
    const timeSinceLastFailure = currentTime - state.lastFailureTime;
    return timeSinceLastFailure < state.recoveryTimeoutMs;
  }
  return false;
};

/**
 * Record a failure and return new state
 */
export const recordFailure = (state: CircuitState, currentTime: number): CircuitState => {
  return {
    ...state,
    failureCount: state.failureCount + 1,
    lastFailureTime: currentTime,
  };
};

/**
 * Record a success and return new state (resets failure count)
 */
export const recordSuccess = (state: CircuitState, currentTime: number): CircuitState => {
  return {
    ...state,
    failureCount: 0,
    lastFailureTime: 0,
    lastSuccessTime: currentTime,
  };
};

/**
 * Reset circuit breaker to initial state
 */
export const resetCircuit = (state: CircuitState): CircuitState => {
  return {
    ...state,
    failureCount: 0,
    lastFailureTime: 0,
    lastSuccessTime: 0,
  };
};

/**
 * Get comprehensive circuit breaker statistics
 */
export const getCircuitStatistics = (state: CircuitState, currentTime: number) => {
  const status = getCircuitStatus(state, currentTime);
  const timeSinceLastFailure = state.lastFailureTime ? currentTime - state.lastFailureTime : 0;
  const timeUntilRecovery = isCircuitOpen(state, currentTime) ? state.recoveryTimeoutMs - timeSinceLastFailure : 0;

  return {
    failureCount: state.failureCount,
    lastFailureTime: state.lastFailureTime,
    lastSuccessTime: state.lastSuccessTime,
    maxFailures: state.maxFailures,
    recoveryTimeoutMs: state.recoveryTimeoutMs,
    state: status,
    timeSinceLastFailureMs: timeSinceLastFailure,
    timeUntilRecoveryMs: Math.max(0, timeUntilRecovery),
  };
};
