import type { RateLimitState } from './types.js';

export const refillTokens = (state: RateLimitState, currentTime: number): RateLimitState => {
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

export const getRequestCountInWindow = (
  requestTimestamps: readonly number[],
  currentTime: number,
  windowMs: number
): number => {
  const windowStart = currentTime - windowMs;
  return requestTimestamps.filter((ts) => ts >= windowStart).length;
};

export const canMakeRequestInAllWindows = (state: RateLimitState, currentTime: number): boolean => {
  if (state.requestsPerSecond !== undefined) {
    const requestsInLastSecond = getRequestCountInWindow(state.requestTimestamps, currentTime, 1000);
    if (requestsInLastSecond >= state.requestsPerSecond) {
      return false;
    }
  }

  if (state.requestsPerMinute !== undefined) {
    const requestsInLastMinute = getRequestCountInWindow(state.requestTimestamps, currentTime, 60_000);
    if (requestsInLastMinute >= state.requestsPerMinute) {
      return false;
    }
  }

  if (state.requestsPerHour !== undefined) {
    const requestsInLastHour = getRequestCountInWindow(state.requestTimestamps, currentTime, 3_600_000);
    if (requestsInLastHour >= state.requestsPerHour) {
      return false;
    }
  }

  return true;
};

export const cleanOldTimestamps = (requestTimestamps: readonly number[], currentTime: number): number[] => {
  const oneHourAgo = currentTime - 3_600_000;
  return requestTimestamps.filter((ts) => ts >= oneHourAgo);
};

export const shouldAllowRequest = (state: RateLimitState, currentTime: number): boolean => {
  const refilled = refillTokens(state, currentTime);
  return refilled.tokens >= 1 && canMakeRequestInAllWindows(refilled, currentTime);
};

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

  const windowStart = currentTime - windowMs;
  const oldestInWindow = requestTimestamps.find((ts) => ts >= windowStart);

  if (!oldestInWindow) {
    return 0;
  }

  return oldestInWindow + windowMs - currentTime + 10;
};

export const calculateWaitTime = (state: RateLimitState, currentTime: number): number => {
  const refilled = refillTokens(state, currentTime);
  let maxWaitTime = 0;

  if (refilled.tokens < 1) {
    const missingTokens = 1 - refilled.tokens;
    const timeUntilNextToken = (missingTokens / state.requestsPerSecond) * 1000;
    maxWaitTime = Math.max(maxWaitTime, Math.ceil(timeUntilNextToken));
  }

  if (state.requestsPerSecond !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 1000, state.requestsPerSecond);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  if (state.requestsPerMinute !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 60_000, state.requestsPerMinute);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  if (state.requestsPerHour !== undefined) {
    const waitTime = getWaitTimeForWindow(refilled.requestTimestamps, currentTime, 3_600_000, state.requestsPerHour);
    maxWaitTime = Math.max(maxWaitTime, waitTime);
  }

  return Math.ceil(maxWaitTime);
};

export const consumeToken = (state: RateLimitState, currentTime: number): RateLimitState => {
  const refilled = refillTokens(state, currentTime);
  const cleaned = cleanOldTimestamps(refilled.requestTimestamps, currentTime);

  return {
    ...refilled,
    requestTimestamps: [...cleaned, currentTime],
    tokens: Math.max(0, refilled.tokens - 1),
  };
};

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
