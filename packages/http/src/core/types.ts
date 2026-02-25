// Pure types for functional core
// No classes, only data structures

import type { RateLimitConfig } from '../types.js';

/**
 * Rate limiter state (immutable)
 */
export interface RateLimitState {
  burstLimit: number;
  lastRefill: number;
  requestTimestamps: number[];
  requestsPerHour: number | undefined;
  requestsPerMinute: number | undefined;
  requestsPerSecond: number;
  tokens: number;
}

/**
 * HTTP error classification
 */
export interface ErrorClassification {
  shouldRetry: boolean;
  type: 'rate_limit' | 'server' | 'client' | 'timeout' | 'unknown';
}

/**
 * Rate limit header parsing result
 */
export interface RateLimitHeaderInfo {
  delayMs?: number | undefined;
  source: string;
}

/**
 * Side effects interface for dependency injection
 */
export interface HttpEffects {
  delay: (ms: number) => Promise<void>;
  fetch: typeof fetch;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => void;
  now: () => number;
}

/**
 * Factory functions for initial states
 */
const assertPositiveFinite = (fieldName: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid rate limit configuration: ${fieldName} must be a positive finite number, got ${value}`);
  }
};

export const createInitialRateLimitState = (config: RateLimitConfig): RateLimitState => {
  assertPositiveFinite('requestsPerSecond', config.requestsPerSecond);

  if (config.burstLimit !== undefined) {
    assertPositiveFinite('burstLimit', config.burstLimit);
  }
  if (config.requestsPerMinute !== undefined) {
    assertPositiveFinite('requestsPerMinute', config.requestsPerMinute);
  }
  if (config.requestsPerHour !== undefined) {
    assertPositiveFinite('requestsPerHour', config.requestsPerHour);
  }

  const burstLimit = config.burstLimit ?? 1;

  return {
    burstLimit,
    lastRefill: 0, // Will be set by effects.now() on first use
    requestTimestamps: [],
    requestsPerHour: config.requestsPerHour,
    requestsPerMinute: config.requestsPerMinute,
    requestsPerSecond: config.requestsPerSecond,
    tokens: burstLimit,
  };
};
