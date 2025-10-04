// Pure rate limiting functions
// All functions are pure - they take state and return new state without side effects

import type { RateLimitState } from './types.js';

/**
 * Refill tokens based on time passed since last refill
 * Uses token bucket algorithm
 */
export const refillTokens = (state: RateLimitState, currentTime: number): RateLimitState => {
  // Initialize lastRefill on first call
  if (state.lastRefill === 0) {
    return {
      ...state,
      lastRefill: currentTime,
    };
  }

  const timePassed = (currentTime - state.lastRefill) / 1000; // Convert to seconds

  if (timePassed <= 0) {
    return state;
  }

  const tokensToAdd = timePassed * state.requestsPerSecond;
  const newTokens = Math.min(state.burstLimit, state.tokens + tokensToAdd);

  return {
    ...state,
    lastRefill: currentTime,
    tokens: newTokens,
  };
};

/**
 * Count requests within a time window
 */
export const getRequestCountInWindow = (
  requestTimestamps: readonly number[],
  currentTime: number,
  windowMs: number
): number => {
  const windowStart = currentTime - windowMs;
  return requestTimestamps.filter((ts) => ts >= windowStart).length;
};

/**
 * Check if request can be made in all configured time windows
 */
export const canMakeRequestInAllWindows = (state: RateLimitState, currentTime: number): boolean => {
  // Check per-second limit
  if (state.requestsPerSecond !== undefined) {
    const requestsInLastSecond = getRequestCountInWindow(state.requestTimestamps, currentTime, 1000);
    if (requestsInLastSecond >= state.requestsPerSecond) {
      return false;
    }
  }

  // Check per-minute limit
  if (state.requestsPerMinute !== undefined) {
    const requestsInLastMinute = getRequestCountInWindow(state.requestTimestamps, currentTime, 60_000);
    if (requestsInLastMinute >= state.requestsPerMinute) {
      return false;
    }
  }

  // Check per-hour limit
  if (state.requestsPerHour !== undefined) {
    const requestsInLastHour = getRequestCountInWindow(state.requestTimestamps, currentTime, 3_600_000);
    if (requestsInLastHour >= state.requestsPerHour) {
      return false;
    }
  }

  return true;
};

/**
 * Remove timestamps older than 1 hour to prevent memory growth
 */
export const cleanOldTimestamps = (requestTimestamps: readonly number[], currentTime: number): number[] => {
  const oneHourAgo = currentTime - 3_600_000;
  return requestTimestamps.filter((ts) => ts >= oneHourAgo);
};

/**
 * Check if a request can be made immediately
 */
export const shouldAllowRequest = (state: RateLimitState, currentTime: number): boolean => {
  const refilled = refillTokens(state, currentTime);
  return refilled.tokens >= 1 && canMakeRequestInAllWindows(refilled, currentTime);
};

/**
 * Calculate wait time for oldest request in a time window
 */
const getWaitTimeForWindow = (
  requestTimestamps: readonly number[],
  currentTime: number,
  windowMs: number,
  maxRequests: number
): number => {
  const requestsInWindow = getRequestCountInWindow(requestTimestamps, currentTime, windowMs);

  if (requestsInWindow < maxRequests) {
    return 0;
  }

  // Find oldest request in window
  const windowStart = currentTime - windowMs;
  const oldestInWindow = requestTimestamps.find((ts) => ts >= windowStart);

  if (!oldestInWindow) {
    return 0;
  }

  // Wait until oldest request falls outside window (+ buffer)
  return oldestInWindow + windowMs - currentTime + 10;
};

/**
 * Calculate how long to wait before next request can be made
 * Returns 0 if request can be made immediately
 */
export const calculateWaitTime = (state: RateLimitState, currentTime: number): number => {
  const refilled = refillTokens(state, currentTime);
  let maxWaitTime = 0;

  // Check token bucket
  if (refilled.tokens < 1) {
    const timeUntilNextToken = (1 / state.requestsPerSecond) * 1000;
    maxWaitTime = Math.max(maxWaitTime, Math.ceil(timeUntilNextToken));
  }

  // Check per-second window
  if (state.requestsPerSecond !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 1000, state.requestsPerSecond);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  // Check per-minute window
  if (state.requestsPerMinute !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 60_000, state.requestsPerMinute);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  // Check per-hour window
  if (state.requestsPerHour !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 3_600_000, state.requestsPerHour);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  return Math.ceil(maxWaitTime);
};

/**
 * Consume a token and record request timestamp
 * Returns new state with token consumed and timestamp added
 */
export const consumeToken = (state: RateLimitState, currentTime: number): RateLimitState => {
  const refilled = refillTokens(state, currentTime);
  const cleaned = cleanOldTimestamps(refilled.requestTimestamps, currentTime);

  return {
    ...refilled,
    requestTimestamps: [...cleaned, currentTime],
    tokens: Math.max(0, refilled.tokens - 1),
  };
};

/**
 * Get current rate limit status (for monitoring/debugging)
 */
export const getRateLimitStatus = (state: RateLimitState, currentTime: number) => {
  const refilled = refillTokens(state, currentTime);

  return {
    maxTokens: state.burstLimit,
    requestsInLastHour: getRequestCountInWindow(refilled.requestTimestamps, currentTime, 3_600_000),
    requestsInLastMinute: getRequestCountInWindow(refilled.requestTimestamps, currentTime, 60_000),
    requestsInLastSecond: getRequestCountInWindow(refilled.requestTimestamps, currentTime, 1000),
    requestsPerHour: state.requestsPerHour,
    requestsPerMinute: state.requestsPerMinute,
    requestsPerSecond: state.requestsPerSecond,
    tokens: refilled.tokens,
  };
};
