import { getLogger } from '@exitbook/shared-logger';

import { RateLimiterFactory } from './rate-limiter.js';
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
 * Centralized HTTP client with rate limiting, retries, and error handling
 * Eliminates duplication across blockchain providers
 */
export class HttpClient {
  private readonly config: HttpClientConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  private readonly rateLimiter: ReturnType<typeof RateLimiterFactory.getOrCreate>;

  constructor(config: HttpClientConfig) {
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
    this.rateLimiter = RateLimiterFactory.getOrCreate(config.providerName, config.rateLimit);

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
    return this.rateLimiter.getStatus();
  }

  /**
   * Temporarily update rate limit settings
   * @param rateLimit New rate limit configuration
   * @returns Function to restore original rate limits
   */
  withRateLimit(rateLimit: RateLimitConfig): () => void {
    const originalRateLimiter = this.rateLimiter;
    // @ts-expect-error - We're intentionally replacing the rate limiter
    this.rateLimiter = RateLimiterFactory.getOrCreate(`${this.config.providerName}-temp-${Date.now()}`, rateLimit);

    // Return cleanup function to restore original
    return () => {
      // @ts-expect-error - We're intentionally replacing the rate limiter
      this.rateLimiter = originalRateLimiter;
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
    const url = this.buildUrl(endpoint);
    const method = options.method || 'GET';
    const timeout = options.timeout || this.config.timeout!;
    let lastError: Error;

    // Wait for rate limit permission before making request
    await this.rateLimiter.waitForPermission();

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      try {
        this.logger.debug(
          `Making HTTP request - URL: ${this.sanitizeUrl(url)}, Method: ${method}, Attempt: ${attempt}/${this.config.retries}`
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

        const response = await fetch(url, {
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
            const retryDelayInfo = this.parseRateLimitHeaders(response.headers);
            const baseDelay = retryDelayInfo.delayMs || 2000; // Default fallback
            const headerSource = retryDelayInfo.source;

            // Apply exponential backoff for consecutive 429 responses
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 60000);

            const willRetry = attempt < this.config.retries!;
            this.logger.warn(
              `Rate limit 429 response received from API${willRetry ? ', waiting before retry' : ', no retries remaining'} - Source: ${headerSource}, BaseDelay: ${baseDelay}ms, ActualDelay: ${delay}ms, Attempt: ${attempt}/${this.config.retries}`
            );

            if (willRetry) {
              await this.delay(delay);
              continue;
            } else {
              throw new RateLimitError(
                `${this.config.providerName} rate limit exceeded`,
                'unknown', // blockchain type not available at this level
                'api_request'
              );
            }
          }

          if (response.status >= 500) {
            throw new ServiceError(
              `${this.config.providerName} service error: ${response.status} ${errorText}`,
              'unknown', // blockchain type not available at this level
              'api_request'
            );
          }

          if (response.status >= 400 && response.status < 500) {
            // Client errors (400-499) should not be retried - they indicate bad requests
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

        // Don't retry client errors (400-499)
        if (lastError.message.includes('HTTP 4')) {
          throw lastError;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        this.logger.warn(
          `Request failed - URL: ${this.sanitizeUrl(url)}, Attempt: ${attempt}/${this.config.retries}, Error: ${lastError.message}`
        );

        if (attempt < this.config.retries!) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
          this.logger.debug(`Retrying after delay - Delay: ${delay}ms, NextAttempt: ${attempt + 1}`);
          await this.delay(delay);
        }
      }
    }

    throw lastError!;
  }

  private buildUrl(endpoint: string): string {
    const baseUrl = this.config.baseUrl.endsWith('/') ? this.config.baseUrl.slice(0, -1) : this.config.baseUrl;

    // If endpoint is empty or just '/', return baseUrl (for RPC endpoints with query params)
    if (!endpoint || endpoint === '' || endpoint === '/') {
      return baseUrl;
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${baseUrl}${cleanEndpoint}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse rate limit headers to determine retry delay
   * Checks multiple header formats in order of preference:
   * 1. Retry-After (seconds or HTTP-date)
   * 2. X-RateLimit-Reset (Unix timestamp)
   * 3. X-Rate-Limit-Reset (Unix timestamp)
   * 4. RateLimit-Reset (delta-seconds)
   */
  private parseRateLimitHeaders(headers: Headers): { delayMs?: number | undefined; source: string } {
    // Try Retry-After first (RFC standard)
    const retryAfter = headers.get('Retry-After');
    if (retryAfter) {
      const parsed = this.parseRetryAfter(retryAfter);
      if (parsed !== null) {
        return { delayMs: parsed, source: 'Retry-After' };
      }
    }

    // Try X-RateLimit-Reset (Unix timestamp in seconds)
    const xRateLimitReset = headers.get('X-RateLimit-Reset');
    if (xRateLimitReset) {
      const delayMs = this.parseUnixTimestamp(xRateLimitReset);
      if (delayMs !== null) {
        return { delayMs, source: 'X-RateLimit-Reset' };
      }
    }

    // Try X-Rate-Limit-Reset (variant spelling)
    const xRateLimitResetVariant = headers.get('X-Rate-Limit-Reset');
    if (xRateLimitResetVariant) {
      const delayMs = this.parseUnixTimestamp(xRateLimitResetVariant);
      if (delayMs !== null) {
        return { delayMs, source: 'X-Rate-Limit-Reset' };
      }
    }

    // Try RateLimit-Reset (IETF draft standard - delta-seconds)
    const rateLimitReset = headers.get('RateLimit-Reset');
    if (rateLimitReset) {
      const seconds = parseInt(rateLimitReset);
      if (!isNaN(seconds) && seconds >= 0) {
        const delayMs = Math.min(seconds * 1000, 30000);
        return { delayMs, source: 'RateLimit-Reset' };
      }
    }

    // No valid headers found
    return { source: 'default' };
  }

  /**
   * Parse Retry-After header value
   * Supports both delay-seconds and HTTP-date formats
   */
  private parseRetryAfter(value: string): number | undefined {
    // Try parsing as integer (delay-seconds)
    const seconds = parseInt(value);
    if (!isNaN(seconds)) {
      if (seconds === 0) {
        this.logger.warn(`Invalid Retry-After: 0 received, using minimum delay of 1000ms`);
        return 1000;
      }

      if (seconds > 0) {
        // Auto-detect if value is in seconds or milliseconds
        // If seconds > 300 (5 minutes), assume it's milliseconds
        // If seconds <= 300, assume it's seconds (RFC standard)
        if (seconds > 300) {
          // Likely already in milliseconds, cap at 30 seconds
          const delayMs = Math.min(seconds, 30000);
          this.logger.debug(`Detected Retry-After as milliseconds: ${seconds}ms`);
          return delayMs;
        } else {
          // Likely in seconds per RFC, convert and cap at 30 seconds
          const delayMs = Math.min(seconds * 1000, 30000);
          this.logger.debug(`Detected Retry-After as seconds: ${seconds}s`);
          return delayMs;
        }
      }
    }

    // Try parsing as HTTP-date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const now = Date.now();
      const delayMs = Math.max(0, date.getTime() - now);
      if (delayMs > 0) {
        const cappedDelay = Math.min(delayMs, 30000);
        this.logger.debug(`Parsed Retry-After as HTTP-date: ${value}, delay: ${cappedDelay}ms`);
        return cappedDelay;
      }
    }

    return;
  }

  /**
   * Parse Unix timestamp and calculate delay in milliseconds
   */
  private parseUnixTimestamp(value: string): number | undefined {
    const timestamp = parseInt(value);
    if (isNaN(timestamp) || timestamp <= 0) {
      return undefined;
    }

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const delaySeconds = Math.max(0, timestamp - now);
    if (delaySeconds > 0) {
      const delayMs = Math.min(delaySeconds * 1000, 30000); // Cap at 30 seconds
      this.logger.debug(`Parsed Unix timestamp: ${timestamp}, delay: ${delayMs}ms`);
      return delayMs;
    }

    return undefined;
  }

  private sanitizeUrl(url: string): string {
    // Remove potential API keys or sensitive query parameters from logs
    const urlObj = new URL(url);
    if (urlObj.searchParams.has('token')) {
      urlObj.searchParams.set('token', '***');
    }
    if (urlObj.searchParams.has('key')) {
      urlObj.searchParams.set('key', '***');
    }
    if (urlObj.searchParams.has('apikey')) {
      urlObj.searchParams.set('apikey', '***');
    }
    return urlObj.toString();
  }
}
