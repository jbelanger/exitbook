import type { RateLimitConfig } from '@crypto/core';
import { RateLimitError, ServiceError } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';

import { RateLimiterFactory } from './rate-limiter.ts';

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  providerName: string;
  rateLimit: RateLimitConfig;
  retries?: number;
  timeout?: number;
}

export interface HttpRequestOptions {
  body?: BodyInit | object | null;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  timeout?: number;
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
        'User-Agent': 'ccxt-crypto-tx-import/1.0.0',
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
    return new Promise(resolve => setTimeout(resolve, ms));
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
   * Convenience method for POST requests
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      body: body as BodyInit | object | null,
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
          body: body ?? null,
          headers,
          method,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');

          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const rawDelay = retryAfter ? parseInt(retryAfter) : null;

            let delay = 2000; // Default fallback

            if (rawDelay !== null) {
              // Auto-detect if value is in seconds or milliseconds
              // If rawDelay > 300 (5 minutes), assume it's milliseconds
              // If rawDelay <= 300, assume it's seconds (RFC standard)
              if (rawDelay > 300) {
                // Likely already in milliseconds, cap at 30 seconds
                delay = Math.min(rawDelay, 30000);
                this.logger.debug(`Detected Retry-After as milliseconds: ${rawDelay}ms`);
              } else {
                // Likely in seconds per RFC, convert and cap at 30 seconds
                delay = Math.min(rawDelay * 1000, 30000);
                this.logger.debug(`Detected Retry-After as seconds: ${rawDelay}s`);
              }
            }

            this.logger.warn(
              `Rate limit exceeded by server, waiting before retry - RawRetryAfter: ${rawDelay}, Delay: ${delay}ms, Attempt: ${attempt}/${this.config.retries}`
            );

            if (attempt < this.config.retries!) {
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
}
