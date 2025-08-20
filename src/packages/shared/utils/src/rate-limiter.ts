import type { RateLimitConfig } from '@crypto/core';
import { getLogger, type Logger } from '@crypto/shared-logger';

/**
 * Token bucket rate limiter implementation
 * Provides proactive rate limiting with burst capacity
 */
export class RateLimiter {
  private readonly logger: Logger;
  private tokens: number;
  private lastRefill: number;
  private readonly config: RateLimitConfig;

  constructor(
    private readonly providerName: string,
    config: RateLimitConfig
  ) {
    this.config = config;
    this.logger = getLogger(`RateLimiter:${providerName}`);
    this.tokens = config.burstLimit || 1;
    this.lastRefill = Date.now();

    this.logger.debug('Rate limiter initialized', {
      requestsPerSecond: config.requestsPerSecond,
      burstLimit: config.burstLimit
    });
  }

  /**
   * Wait for rate limit permission before making a request
   * Returns immediately if tokens are available, otherwise waits
   */
  async waitForPermission(): Promise<void> {
    this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const timeUntilNextToken = (1 / (this.config.requestsPerSecond || 1)) * 1000;
    const waitTime = Math.ceil(timeUntilNextToken);

    this.logger.debug('Rate limit reached, waiting', {
      waitTimeMs: waitTime,
      tokensAvailable: this.tokens
    });

    await this.delay(waitTime);

    // Retry after waiting
    return this.waitForPermission();
  }

  /**
   * Check if a request can be made immediately without waiting
   */
  canMakeRequest(): boolean {
    this.refillTokens();
    return this.tokens >= 1;
  }

  /**
   * Get current rate limit status
   */
  getStatus(): { tokens: number; maxTokens: number; requestsPerSecond: number } {
    this.refillTokens();
    return {
      tokens: this.tokens,
      maxTokens: this.config.burstLimit || 1,
      requestsPerSecond: this.config.requestsPerSecond || 1
    };
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // Convert to seconds

    if (timePassed > 0) {
      const tokensToAdd = timePassed * (this.config.requestsPerSecond || 1);
      this.tokens = Math.min(this.config.burstLimit || 1, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Rate limiter factory to ensure one limiter per provider
 */
export class RateLimiterFactory {
  private static limiters = new Map<string, RateLimiter>();

  static getOrCreate(providerName: string, config: RateLimitConfig): RateLimiter {
    if (!this.limiters.has(providerName)) {
      this.limiters.set(providerName, new RateLimiter(providerName, config));
    }
    return this.limiters.get(providerName)!;
  }

  static reset(providerName?: string): void {
    if (providerName) {
      this.limiters.delete(providerName);
    } else {
      this.limiters.clear();
    }
  }
}