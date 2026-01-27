import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';
import type { ZodType } from 'zod';

import * as HttpUtils from './core/http-utils.js';
import * as RateLimitCore from './core/rate-limit.js';
import type { HttpEffects, RateLimitState } from './core/types.js';
import { createInitialRateLimitState } from './core/types.js';
import { sanitizeEndpoint } from './instrumentation.js';
import type { HttpClientConfig, HttpRequestOptions } from './types.js';
import { RateLimitError, ResponseValidationError, ServiceError } from './types.js';

export class HttpClient {
  private readonly config: HttpClientConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  private readonly effects: HttpEffects;

  // Mutable state (only place side effects live)
  private rateLimitState: RateLimitState;

  // Async mutex for thread-safe rate limiter access
  private rateLimiterLock: Promise<void> = Promise.resolve();

  constructor(config: HttpClientConfig, effects?: Partial<HttpEffects>) {
    this.config = {
      defaultHeaders: {
        Accept: 'application/json',
        'User-Agent': 'exitbook/1.0.0',
      },
      retries: 3,
      timeout: 10000,
      ...config,
    };

    this.logger = getLogger(`HttpClient:${config.providerName}`);

    // Initialize effects with production defaults
    this.effects = {
      delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: globalThis.fetch,
      log: (level, message, metadata) => {
        if (metadata) {
          this.logger[level](metadata, message);
        } else {
          this.logger[level](message);
        }
      },
      now: () => Date.now(),
      ...effects,
    };

    // Initialize pure state
    this.rateLimitState = createInitialRateLimitState(config.rateLimit);

    this.logger.debug(
      `HTTP client initialized - BaseUrl: ${config.baseUrl}, Timeout: ${this.config.timeout}ms, Retries: ${this.config.retries}, RateLimit: ${JSON.stringify(config.rateLimit)}`
    );
  }

  /**
   * Convenience method for GET requests with schema validation
   */
  async get<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, 'method'> & { schema: ZodType<T> }
  ): Promise<Result<T, Error>>;
  /**
   * Convenience method for GET requests without validation
   */
  async get<T = unknown>(endpoint: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<Result<T, Error>>;
  async get<T = unknown>(
    endpoint: string,
    options: Omit<HttpRequestOptions, 'method'> = {}
  ): Promise<Result<T, Error>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus() {
    const now = this.effects.now();
    return RateLimitCore.getRateLimitStatus(this.rateLimitState, now);
  }

  /**
   * Convenience method for POST requests with schema validation
   */
  async post<T>(
    endpoint: string,
    body: unknown,
    options: Omit<HttpRequestOptions, 'method' | 'body'> & { schema: ZodType<T> }
  ): Promise<Result<T, Error>>;
  /**
   * Convenience method for POST requests without validation
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>
  ): Promise<Result<T, Error>>;
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<Result<T, Error>> {
    return this.request<T>(endpoint, {
      ...options,
      body: body as string | Buffer | Uint8Array | object | undefined,
      method: 'POST',
    });
  }

  /**
   * Make an HTTP request with rate limiting, retries, and error handling
   */
  async request<T = unknown>(endpoint: string, options: HttpRequestOptions = {}): Promise<Result<T, Error>> {
    const url = HttpUtils.buildUrl(this.config.baseUrl, endpoint);
    const method = options.method || 'GET';
    const timeout = options.timeout || this.config.timeout!;
    const hooks = this.config.hooks;
    const sanitizedEndpoint = sanitizeEndpoint(endpoint);
    let lastError: Error | undefined;

    // Wait for rate limit permission before making request
    const rateLimitResult = await this.waitForRateLimit();
    if (rateLimitResult.isErr()) {
      return err(rateLimitResult.error);
    }

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      const startTime = this.effects.now();
      hooks?.onRequestStart?.({ endpoint: sanitizedEndpoint, method, timestamp: startTime });
      let response: Response | undefined;
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;
      let outcome: 'success' | 'failure' | undefined;
      let outcomeError: string | undefined;
      let outcomeStatus: number | undefined;

      try {
        this.effects.log(
          'debug',
          `Making HTTP request - URL: ${HttpUtils.sanitizeUrl(url)}, Method: ${method}, Attempt: ${attempt}/${this.config.retries}`
        );

        timeoutId = setTimeout(() => controller.abort(), timeout);

        const headers = {
          ...this.config.defaultHeaders,
          ...options.headers,
        };

        let body: string | undefined;
        if (options.body) {
          if (typeof options.body === 'object') {
            body = JSON.stringify(options.body);
            headers['Content-Type'] = 'application/json';
          } else {
            body = options.body;
          }
        }

        response = await this.effects.fetch(url, {
          // eslint-disable-next-line unicorn/no-null -- 'fetch' requires null for empty body, not undefined
          body: body ?? null,
          headers,
          method,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          outcome = 'failure';
          outcomeStatus = response.status;
          outcomeError = `HTTP ${response.status}: ${errorText}`;

          if (response.status === 429) {
            const now = this.effects.now();
            const headersObj = Object.fromEntries(response.headers.entries());
            const retryDelayInfo = HttpUtils.parseRateLimitHeaders(headersObj, now);
            const baseDelay = retryDelayInfo.delayMs || 2000;
            const headerSource = retryDelayInfo.source;

            // Apply exponential backoff for consecutive 429 responses
            const delay = HttpUtils.calculateExponentialBackoff(attempt, baseDelay, 60000);
            hooks?.onRateLimited?.({ retryAfterMs: delay, status: response.status });

            const willRetry = attempt < this.config.retries!;
            this.effects.log(
              'warn',
              `Rate limit 429 response received from API${willRetry ? ', waiting before retry' : ', no retries remaining'} - Source: ${headerSource}, BaseDelay: ${baseDelay}ms, ActualDelay: ${delay}ms, Attempt: ${attempt}/${this.config.retries}`
            );

            if (willRetry) {
              hooks?.onBackoff?.({ attemptNumber: attempt, delayMs: delay, reason: 'rate_limit' });
              await this.effects.delay(delay);
              continue;
            } else {
              throw new RateLimitError(`${this.config.providerName} rate limit exceeded`, 'unknown', 'api_request');
            }
          }

          if (response.status >= 500) {
            throw new ServiceError(
              `${this.config.providerName} service error: ${response.status} ${errorText}`,
              'unknown',
              'api_request'
            );
          }

          if (response.status >= 400 && response.status < 500) {
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Handle 204 No Content and empty responses
        if (response.status === 204 || response.headers.get('content-length') === '0') {
          outcome = 'success';
          outcomeStatus = response.status;
          return ok(undefined as T);
        }

        const data = (await response.json()) as T;

        // Validate response with schema if provided
        if (options.schema) {
          const schema = options.schema as ZodType<T>;
          const parseResult = schema.safeParse(data);
          if (!parseResult.success) {
            // Collect all validation issues
            const allIssues = parseResult.error.issues.map((issue) => ({
              message: issue.message,
              path: issue.path.join('.'),
            }));

            // Format first 5 for error message
            const firstFiveErrors = allIssues
              .slice(0, 5)
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join('; ');

            const errorCount = allIssues.length;
            const truncatedPayload = JSON.stringify(data).slice(0, 500);

            this.effects.log(
              'error',
              `Response validation failed (showing first 5 of ${errorCount} errors): ${firstFiveErrors}`,
              {
                method,
                providerName: this.config.providerName,
                status: response.status,
                truncatedPayload,
                url: HttpUtils.sanitizeUrl(url),
              }
            );

            outcome = 'failure';
            outcomeStatus = response.status;
            outcomeError = `Response validation failed: ${firstFiveErrors}`;
            return err(
              new ResponseValidationError(
                `Response validation failed: ${firstFiveErrors}`,
                this.config.providerName,
                endpoint,
                allIssues,
                truncatedPayload
              )
            );
          }
          outcome = 'success';
          outcomeStatus = response.status;
          return ok(parseResult.data);
        }

        outcome = 'success';
        outcomeStatus = response.status;
        return ok(data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        outcome = 'failure';
        outcomeStatus = response?.status;
        outcomeError = lastError.message;

        if (
          error instanceof RateLimitError ||
          error instanceof ServiceError ||
          error instanceof ResponseValidationError
        ) {
          return err(lastError);
        }

        if (lastError.message.includes('HTTP 4')) {
          return err(lastError);
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        this.effects.log(
          'warn',
          `Request failed - URL: ${HttpUtils.sanitizeUrl(url)}, Attempt: ${attempt}/${this.config.retries}, Error: ${lastError.message}`,
          {
            method,
            providerName: this.config.providerName,
          }
        );

        if (attempt < this.config.retries!) {
          const delay = HttpUtils.calculateExponentialBackoff(attempt, 1000, 10000);
          this.effects.log('debug', `Retrying after delay - Delay: ${delay}ms, NextAttempt: ${attempt + 1}`);
          hooks?.onBackoff?.({ attemptNumber: attempt, delayMs: delay, reason: 'retry' });
          await this.effects.delay(delay);
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        const status = response?.status ?? 0;
        const errorLabel = response ? undefined : lastError?.name || lastError?.message;
        if (outcome === 'success') {
          hooks?.onRequestSuccess?.({
            endpoint: sanitizedEndpoint,
            method,
            status: outcomeStatus ?? status,
            durationMs: this.effects.now() - startTime,
          });
        } else if (outcome === 'failure' && outcomeError) {
          hooks?.onRequestFailure?.({
            endpoint: sanitizedEndpoint,
            method,
            status: outcomeStatus,
            error: outcomeError,
            durationMs: this.effects.now() - startTime,
          });
        }
        this.recordMetric(endpoint, method, status, startTime, errorLabel);
      }
    }

    return err(lastError ?? new Error('Request failed with unknown error'));
  }

  /**
   * Cleanup resources.
   * Note: globalThis.fetch doesn't support manual connection cleanup, so this is a no-op.
   * However, it provides a lifecycle hook for future implementations and documents intent.
   */
  destroy(): void {
    // No-op: fetch API doesn't expose HTTP connection pool management
    this.logger.debug('HTTP client destroyed');
  }

  /**
   * Record request metric if instrumentation is enabled
   */
  private recordMetric(endpoint: string, method: string, status: number, startTime: number, error?: string): void {
    if (!this.config.instrumentation || !this.config.service) {
      return;
    }

    this.config.instrumentation.record({
      durationMs: this.effects.now() - startTime,
      endpoint: sanitizeEndpoint(endpoint),
      error,
      method,
      provider: this.config.providerName,
      service: this.config.service,
      status,
      timestamp: this.effects.now(),
    });
  }

  /**
   * Wait for rate limit permission (delegates to pure functions)
   * Thread-safe via async mutex to prevent concurrent state modifications
   */
  private async waitForRateLimit(): Promise<Result<void, Error>> {
    // Acquire lock to ensure only one request at a time modifies rate limiter state
    const previousLock = this.rateLimiterLock;
    let releaseLock: () => void;

    this.rateLimiterLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      // Wait for previous request to finish with rate limiter
      await previousLock;

      // Now we have exclusive access to rate limiter state
      const now = this.effects.now();

      // Refill tokens and check if we can proceed
      this.rateLimitState = RateLimitCore.refillTokens(this.rateLimitState, now);
      this.rateLimitState = {
        ...this.rateLimitState,
        requestTimestamps: RateLimitCore.cleanOldTimestamps(this.rateLimitState.requestTimestamps, now),
      };

      const canProceed = RateLimitCore.shouldAllowRequest(this.rateLimitState, now);

      if (canProceed) {
        // Consume token and record timestamp
        this.rateLimitState = RateLimitCore.consumeToken(this.rateLimitState, now);
        return ok();
      }

      // Calculate wait time
      const waitTimeMs = RateLimitCore.calculateWaitTime(this.rateLimitState, now);

      this.effects.log(
        'debug',
        `Rate limit enforced, waiting before sending request - WaitTimeMs: ${waitTimeMs}, TokensAvailable: ${this.rateLimitState.tokens}, Status: ${JSON.stringify(RateLimitCore.getRateLimitStatus(this.rateLimitState, now))}`
      );

      // Wait WITHOUT holding the lock so other requests can queue up
      await this.effects.delay(waitTimeMs);

      // Recursively retry (will re-acquire lock)
      return this.waitForRateLimit();
    } finally {
      // Release lock for next waiting request
      releaseLock!();
    }
  }
}
