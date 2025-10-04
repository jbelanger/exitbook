import { getLogger } from '@exitbook/shared-logger';

import * as HttpUtils from './core/http-utils.ts';
import * as RateLimitCore from './core/rate-limit.ts';
import type { HttpEffects, RateLimitState } from './core/types.ts';
import { createInitialRateLimitState } from './core/types.ts';
import type { RateLimitConfig } from './types.ts';
import { RateLimitError, ServiceError } from './types.ts';

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string> | undefined;
  providerName: string;
  rateLimit: RateLimitConfig;
  retries?: number | undefined;
  timeout?: number | undefined;
}

export interface HttpRequestOptions {
  body?: string | Buffer | Uint8Array | object | undefined;
  headers?: Record<string, string> | undefined;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
  timeout?: number | undefined;
}

/**
 * Imperative shell wrapper for pure HTTP core functions
 * Maintains backward compatibility while using functional core
 */
export class HttpClient {
  private readonly config: HttpClientConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  private readonly effects: HttpEffects;

  // Mutable state (only place side effects live)
  private rateLimitState: RateLimitState;

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
   * Convenience method for GET requests
   */
  async get<T = unknown>(endpoint: string, options: Omit<HttpRequestOptions, 'method'> = {}): Promise<T> {
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
   * Temporarily update rate limit settings
   * @param rateLimit New rate limit configuration
   * @returns Function to restore original rate limits
   */
  withRateLimit(rateLimit: RateLimitConfig): () => void {
    const originalState = this.rateLimitState;
    this.rateLimitState = createInitialRateLimitState(rateLimit);

    return () => {
      this.rateLimitState = originalState;
    };
  }

  /**
   * Convenience method for POST requests
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      body: body as string | Buffer | Uint8Array | object | undefined,
      method: 'POST',
    });
  }

  /**
   * Make an HTTP request with rate limiting, retries, and error handling
   */
  async request<T = unknown>(endpoint: string, options: HttpRequestOptions = {}): Promise<T> {
    const url = HttpUtils.buildUrl(this.config.baseUrl, endpoint);
    const method = options.method || 'GET';
    const timeout = options.timeout || this.config.timeout!;
    let lastError: Error;

    // Wait for rate limit permission before making request
    await this.waitForRateLimit();

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      try {
        this.effects.log(
          'debug',
          `Making HTTP request - URL: ${HttpUtils.sanitizeUrl(url)}, Method: ${method}, Attempt: ${attempt}/${this.config.retries}`
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

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

        const response = await this.effects.fetch(url, {
          // eslint-disable-next-line unicorn/no-null -- 'fetch' requires null for empty body, not undefined
          body: body ?? null,
          headers,
          method,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');

          if (response.status === 429) {
            const now = this.effects.now();
            const headersObj = Object.fromEntries(response.headers.entries());
            const retryDelayInfo = HttpUtils.parseRateLimitHeaders(headersObj, now);
            const baseDelay = retryDelayInfo.delayMs || 2000;
            const headerSource = retryDelayInfo.source;

            // Apply exponential backoff for consecutive 429 responses
            const delay = HttpUtils.calculateExponentialBackoff(attempt, baseDelay, 60000);

            const willRetry = attempt < this.config.retries!;
            this.effects.log(
              'warn',
              `Rate limit 429 response received from API${willRetry ? ', waiting before retry' : ', no retries remaining'} - Source: ${headerSource}, BaseDelay: ${baseDelay}ms, ActualDelay: ${delay}ms, Attempt: ${attempt}/${this.config.retries}`
            );

            if (willRetry) {
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

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof RateLimitError || error instanceof ServiceError) {
          throw error;
        }

        if (lastError.message.includes('HTTP 4')) {
          throw lastError;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        this.effects.log(
          'warn',
          `Request failed - URL: ${HttpUtils.sanitizeUrl(url)}, Attempt: ${attempt}/${this.config.retries}, Error: ${lastError.message}`
        );

        if (attempt < this.config.retries!) {
          const delay = HttpUtils.calculateExponentialBackoff(attempt, 1000, 10000);
          this.effects.log('debug', `Retrying after delay - Delay: ${delay}ms, NextAttempt: ${attempt + 1}`);
          await this.effects.delay(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Wait for rate limit permission (delegates to pure functions)
   */
  private async waitForRateLimit(): Promise<void> {
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
      return;
    }

    // Calculate wait time
    const waitTimeMs = RateLimitCore.calculateWaitTime(this.rateLimitState, now);

    this.effects.log(
      'debug',
      `Rate limit enforced, waiting before sending request - WaitTimeMs: ${waitTimeMs}, TokensAvailable: ${this.rateLimitState.tokens}, Status: ${JSON.stringify(RateLimitCore.getRateLimitStatus(this.rateLimitState, now))}`
    );

    await this.effects.delay(waitTimeMs);

    // Retry after waiting
    return this.waitForRateLimit();
  }
}
