import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';
import { Agent, fetch as undiciFetch } from 'undici';
import type { ZodType } from 'zod';

import * as HttpUtils from './core/http-utils.js';
import * as RateLimitCore from './core/rate-limit.js';
import type { HttpEffects, RateLimitState } from './core/types.js';
import { createInitialRateLimitState } from './core/types.js';
import { sanitizeEndpoint } from './instrumentation.js';
import type { HttpClientConfig, HttpClientHooks, HttpRequestOptions } from './types.js';
import { HttpError, RateLimitError, ResponseValidationError } from './types.js';

export class HttpClient {
  private readonly config: HttpClientConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  private readonly effects: HttpEffects;
  private readonly agent: Agent;

  // Mutable state (only place side effects live)
  private rateLimitState: RateLimitState;

  // Async mutex for thread-safe rate limiter access
  private rateLimiterLock: Promise<void> = Promise.resolve();

  // Close state (for idempotent cleanup)
  private closePromise?: Promise<void>;
  private isClosed = false;

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

    // Initialize undici agent for connection pooling and proper cleanup
    this.agent = new Agent({
      keepAliveTimeout: 10000, // 10 seconds
      keepAliveMaxTimeout: 60000, // 60 seconds
      pipelining: 1,
    });

    // Initialize effects with production defaults
    this.effects = {
      delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: ((url: string | URL, init?: RequestInit) =>
        undiciFetch(url, { ...init, dispatcher: this.agent })) as typeof fetch,
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

    // Emit start event once before retry loop (logical request started)
    const startTime = this.effects.now();
    hooks?.onRequestStart?.({ endpoint: sanitizedEndpoint, method, timestamp: startTime });

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      let response: Response | undefined;
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;
      let outcome: 'success' | 'failure' | undefined;
      let outcomeError: string | undefined;
      let outcomeStatus: number | undefined;
      const attemptStartTime = this.effects.now();

      try {
        this.effects.log(
          'debug',
          `Making HTTP request - URL: ${HttpUtils.sanitizeUrl(url)}, Method: ${method}, Attempt: ${attempt}/${this.config.retries}`
        );

        timeoutId = setTimeout(() => controller.abort(), timeout);

        // Regenerate body+headers on each attempt if buildRequest provided (for per-request signing)
        const attemptOptions = options.buildRequest ? { ...options, ...options.buildRequest() } : options;

        const headers = {
          ...this.config.defaultHeaders,
          ...attemptOptions.headers,
        };

        let body: string | undefined;
        if (attemptOptions.body) {
          if (typeof attemptOptions.body === 'object') {
            body = JSON.stringify(attemptOptions.body);
            headers['Content-Type'] = 'application/json';
          } else {
            body = attemptOptions.body;
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
            const retryResult = await this.handleRateLimitResponse(response, attempt, hooks);
            if (retryResult === 'continue') {
              // Suppress hook for intermediate attempt (only report final outcome)
              outcome = undefined;
              outcomeError = undefined;
              continue;
            }
            throw new RateLimitError(`${this.config.providerName} rate limit exceeded`);
          }

          throw new HttpError(`HTTP ${response.status}: ${errorText}`, response.status, errorText);
        }

        // Handle 204 No Content and empty responses
        if (response.status === 204 || response.headers.get('content-length') === '0') {
          outcome = 'success';
          outcomeStatus = response.status;
          return ok(undefined as T);
        }

        const data = (await response.json()) as T;

        // Check for application-level rate limits (e.g. Etherscan returns HTTP 200 with rate limit in body)
        if (options.validateResponse) {
          const rateLimitError = options.validateResponse(data);
          if (rateLimitError) {
            outcome = 'failure';
            outcomeStatus = response.status;
            outcomeError = rateLimitError.message;

            const retryResult = await this.handleApplicationRateLimit(rateLimitError, response.status, attempt, hooks);
            if (retryResult === 'continue') {
              // Suppress hook for intermediate attempt (only report final outcome)
              outcome = undefined;
              outcomeError = undefined;
              continue;
            }
            return err(rateLimitError);
          }
        }

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

        if (error instanceof RateLimitError || error instanceof HttpError || error instanceof ResponseValidationError) {
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
          // Suppress hook for intermediate attempt (only report final outcome)
          outcome = undefined;
          outcomeError = undefined;
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
        // Per-attempt timing for accurate latency metrics (not cumulative across retries)
        this.recordMetric(endpoint, method, status, attemptStartTime, errorLabel);
      }
    }

    return err(lastError ?? new Error('Request failed with unknown error'));
  }

  /**
   * Cleanup resources.
   * Closes the undici agent to terminate all keep-alive connections.
   * This allows the process to exit naturally without requiring process.exit().
   *
   * Idempotent: safe to call multiple times. Subsequent calls return the same promise.
   */
  async close(): Promise<void> {
    // Idempotency: return existing close operation if in progress
    if (this.closePromise) {
      return this.closePromise;
    }

    if (this.isClosed) {
      return;
    }

    this.closePromise = (async () => {
      this.logger.debug('Closing HTTP agent connections');
      try {
        await this.agent.close();
        this.isClosed = true;
        this.logger.debug('HTTP agent closed successfully');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to close HTTP agent: ${errorMessage}`);
        throw new Error(`HTTP agent cleanup failed: ${errorMessage}`);
      }
    })();

    return this.closePromise;
  }

  /**
   * Handle HTTP 429 rate limit response.
   * Returns 'continue' if should retry, 'throw' if should throw error.
   */
  private async handleRateLimitResponse(
    response: Response,
    attempt: number,
    hooks: HttpClientHooks | undefined
  ): Promise<'continue' | 'throw'> {
    const now = this.effects.now();
    const headersObj = Object.fromEntries(response.headers.entries());
    const retryDelayInfo = HttpUtils.parseRateLimitHeaders(headersObj, now);
    const baseDelay = retryDelayInfo.delayMs || 2000;
    const headerSource = retryDelayInfo.source;

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
      return 'continue';
    }

    return 'throw';
  }

  /**
   * Handle application-level rate limit (e.g., Etherscan).
   * Returns 'continue' if should retry, 'return' if should return error.
   */
  private async handleApplicationRateLimit(
    rateLimitError: RateLimitError,
    status: number,
    attempt: number,
    hooks: HttpClientHooks | undefined
  ): Promise<'continue' | 'return'> {
    const baseDelay = rateLimitError.retryAfter || 2000;
    const delay = HttpUtils.calculateExponentialBackoff(attempt, baseDelay, 60000);
    const willRetry = attempt < this.config.retries!;

    hooks?.onRateLimited?.({ retryAfterMs: delay, status });
    this.effects.log(
      'warn',
      `Application-level rate limit detected${willRetry ? ', waiting before retry' : ', no retries remaining'} - Reason: ${rateLimitError.message}, BaseDelay: ${baseDelay}ms, ActualDelay: ${delay}ms, Attempt: ${attempt}/${this.config.retries}`
    );

    if (willRetry) {
      hooks?.onBackoff?.({ attemptNumber: attempt, delayMs: delay, reason: 'rate_limit' });
      await this.effects.delay(delay);
      return 'continue';
    }

    return 'return';
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
    // Loop to avoid recursion while ensuring we never wait while holding the lock.
    while (true) {
      // Acquire lock to ensure only one request at a time modifies rate limiter state
      const previousLock = this.rateLimiterLock;
      let releaseLock: () => void;

      this.rateLimiterLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      let waitTimeMs = 0;

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
        waitTimeMs = RateLimitCore.calculateWaitTime(this.rateLimitState, now);

        this.effects.log(
          'debug',
          `Rate limit enforced, waiting before sending request - WaitTimeMs: ${waitTimeMs}, TokensAvailable: ${this.rateLimitState.tokens}, Status: ${JSON.stringify(RateLimitCore.getRateLimitStatus(this.rateLimitState, now))}`
        );
      } finally {
        // Release lock for next waiting request
        releaseLock!();
      }

      // Wait WITHOUT holding the lock so other requests can queue up
      await this.effects.delay(waitTimeMs);
    }
  }
}
