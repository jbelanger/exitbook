import type { ZodType } from 'zod';

import type { InstrumentationCollector } from './instrumentation.js';

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  hooks?: HttpClientHooks | undefined;
  providerName: string;
  rateLimit: RateLimitConfig;
  retries?: number | undefined;
  service?: 'blockchain' | 'exchange' | 'price' | undefined;
  timeout?: number | undefined;
}

export interface HttpRequestOptions {
  body?: string | Buffer | Uint8Array | object | undefined;
  headers?: Record<string, string> | undefined;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
  schema?: ZodType<unknown> | undefined;
  timeout?: number | undefined;
  /**
   * Inspect the parsed response body before it is returned. Return a RateLimitError
   * to trigger the same retry-with-backoff path as an HTTP 429.
   * Useful for APIs (e.g. Etherscan) that signal rate limits inside a 200 body.
   */
  validateResponse?: ((data: unknown) => RateLimitError | void) | undefined;
}

export interface HttpClientHooks {
  /**
   * Called once when a logical request starts (before any retry attempts).
   * Paired with exactly one terminal event (onRequestSuccess or onRequestFailure).
   *
   * Note: Retry attempts do not trigger additional start events.
   * Use onBackoff to track individual retry attempts.
   */
  onRequestStart?: (event: { endpoint: string; method: string; timestamp: number }) => void;

  /**
   * Called once when a logical request succeeds (after all retries if applicable).
   * The durationMs includes time spent on all retry attempts.
   */
  onRequestSuccess?: (event: { durationMs: number; endpoint: string; method: string; status: number }) => void;

  /**
   * Called once when a logical request fails after all retry attempts exhausted.
   *
   * Note: Intermediate failures during retry are suppressed to avoid polluting
   * circuit breaker metrics. Only the final outcome is reported.
   */
  onRequestFailure?: (event: {
    durationMs: number;
    endpoint: string;
    error: string;
    method: string;
    status?: number | undefined;
  }) => void;

  onRateLimited?: (event: { retryAfterMs?: number | undefined; status?: number | undefined }) => void;

  /**
   * Called before each retry attempt (including after rate limit backoffs).
   * Use this to track retry behavior and count physical request attempts.
   */
  onBackoff?: (event: { attemptNumber: number; delayMs: number; reason: 'rate_limit' | 'retry' }) => void;
}

// HTTP-related error classes
export class HttpError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ResponseValidationError extends Error {
  constructor(
    message: string,
    public providerName: string,
    public endpoint: string,
    public validationIssues: { message: string; path: string }[],
    public truncatedPayload: string
  ) {
    super(message);
    this.name = 'ResponseValidationError';
  }
}

export interface RateLimitConfig {
  burstLimit?: number | undefined;
  requestsPerHour?: number | undefined;
  requestsPerMinute?: number | undefined;
  requestsPerSecond: number;
}
