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
export const createInitialRateLimitState = (config: RateLimitConfig): RateLimitState => ({
  burstLimit: config.burstLimit || 1,
  lastRefill: 0, // Will be set by effects.now() on first use
  requestTimestamps: [],
  requestsPerHour: config.requestsPerHour,
  requestsPerMinute: config.requestsPerMinute,
  requestsPerSecond: config.requestsPerSecond,
  tokens: config.burstLimit || 1,
});
