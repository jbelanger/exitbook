import { Logger } from '../infrastructure/logging';
import { RateLimitConfig, RateLimitError, ServiceError } from '../core/types/index';
import { RateLimiterFactory } from './rate-limiter';

export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  defaultHeaders?: Record<string, string>;
  rateLimit: RateLimitConfig;
  providerName: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
}

/**
 * Centralized HTTP client with rate limiting, retries, and error handling
 * Eliminates duplication across blockchain providers
 */
export class HttpClient {
  private readonly logger: Logger;
  private readonly config: HttpClientConfig;
  private readonly rateLimiter: ReturnType<typeof RateLimiterFactory.getOrCreate>;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 10000,
      retries: 3,
      defaultHeaders: {
        'Accept': 'application/json',
        'User-Agent': 'ccxt-crypto-tx-import/1.0.0'
      },
      ...config
    };
    
    this.logger = new Logger(`HttpClient:${config.providerName}`);
    this.rateLimiter = RateLimiterFactory.getOrCreate(config.providerName, config.rateLimit);

    this.logger.info('HTTP client initialized', {
      baseUrl: config.baseUrl,
      timeout: this.config.timeout,
      retries: this.config.retries,
      rateLimit: config.rateLimit
    });
  }

  /**
   * Make an HTTP request with rate limiting, retries, and error handling
   */
  async request<T = any>(endpoint: string, options: HttpRequestOptions = {}): Promise<T> {
    const url = this.buildUrl(endpoint);
    const method = options.method || 'GET';
    const timeout = options.timeout || this.config.timeout!;
    let lastError: Error;

    // Wait for rate limit permission before making request
    await this.rateLimiter.waitForPermission();

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      try {
        this.logger.debug('Making HTTP request', { 
          url: this.sanitizeUrl(url), 
          method,
          attempt, 
          maxRetries: this.config.retries 
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const headers = {
          ...this.config.defaultHeaders,
          ...options.headers
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
          method,
          headers,
          body,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');

          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2000;

            this.logger.warn('Rate limit exceeded by server, waiting before retry', {
              delay,
              attempt,
              maxRetries: this.config.retries
            });

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

        const data = await response.json() as T;
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

        this.logger.warn('Request failed', {
          url: this.sanitizeUrl(url),
          attempt,
          maxRetries: this.config.retries,
          error: lastError.message
        });

        if (attempt < this.config.retries!) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff
          this.logger.debug('Retrying after delay', { delay, nextAttempt: attempt + 1 });
          await this.delay(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Convenience method for GET requests
   */
  async get<T = any>(endpoint: string, options: Omit<HttpRequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * Convenience method for POST requests
   */
  async post<T = any>(endpoint: string, body?: any, options: Omit<HttpRequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  private buildUrl(endpoint: string): string {
    const baseUrl = this.config.baseUrl.endsWith('/') 
      ? this.config.baseUrl.slice(0, -1) 
      : this.config.baseUrl;
    
    // If endpoint is empty or just '/', return baseUrl (for RPC endpoints with query params)
    if (!endpoint || endpoint === '' || endpoint === '/') {
      return baseUrl;
    }
    
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${baseUrl}${cleanEndpoint}`;
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}