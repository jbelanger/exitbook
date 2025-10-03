import { type Logger, getLogger } from '@exitbook/shared-logger';

import type { RateLimitConfig } from './types.ts';

/**
 * Multi-window rate limiter implementation
 * Enforces per-second, per-minute, and per-hour limits simultaneously
 * Uses sliding window algorithm to track requests across all time periods
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly logger: Logger;
  private readonly requestTimestamps: number[] = [];
  private tokens: number;
  private lastRefill: number;

  constructor(providerName: string, config: RateLimitConfig) {
    this.config = config;
    this.logger = getLogger(`RateLimiter:${providerName}`);
    this.tokens = config.burstLimit || 1;
    this.lastRefill = Date.now();

    this.logger.debug(
      `Rate limiter initialized - RequestsPerSecond: ${config.requestsPerSecond}, RequestsPerMinute: ${config.requestsPerMinute}, RequestsPerHour: ${config.requestsPerHour}, BurstLimit: ${config.burstLimit}`
    );
  }

  /**
   * Check if a request can be made immediately without waiting
   */
  canMakeRequest(): boolean {
    this.refillTokens();
    this.cleanOldTimestamps();
    return this.tokens >= 1 && this.canMakeRequestInAllWindows();
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    maxTokens: number;
    requestsInLastHour: number;
    requestsInLastMinute: number;
    requestsInLastSecond: number;
    requestsPerHour?: number | undefined;
    requestsPerMinute?: number | undefined;
    requestsPerSecond: number;
    tokens: number;
  } {
    this.refillTokens();
    this.cleanOldTimestamps();
    const now = Date.now();

    return {
      maxTokens: this.config.burstLimit || 1,
      requestsInLastHour: this.getRequestCountInWindow(now, 3600000),
      requestsInLastMinute: this.getRequestCountInWindow(now, 60000),
      requestsInLastSecond: this.getRequestCountInWindow(now, 1000),
      requestsPerHour: this.config.requestsPerHour,
      requestsPerMinute: this.config.requestsPerMinute,
      requestsPerSecond: this.config.requestsPerSecond || 1,
      tokens: this.tokens,
    };
  }

  /**
   * Wait for rate limit permission before making a request
   * Returns immediately if tokens are available, otherwise waits
   */
  async waitForPermission(): Promise<void> {
    this.refillTokens();
    this.cleanOldTimestamps();

    // Check if we can make a request in all time windows
    const waitTimeMs = this.getWaitTimeMs();

    if (waitTimeMs === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.requestTimestamps.push(Date.now());
      return;
    }

    this.logger.debug(
      `Rate limit enforced, waiting before sending request - WaitTimeMs: ${waitTimeMs}, TokensAvailable: ${this.tokens}, Status: ${JSON.stringify(this.getStatus())}`
    );

    await this.delay(waitTimeMs);

    // Retry after waiting
    return this.waitForPermission();
  }

  private canMakeRequestInAllWindows(): boolean {
    const now = Date.now();

    // Check per-second limit
    if (this.config.requestsPerSecond) {
      const requestsInLastSecond = this.getRequestCountInWindow(now, 1000);
      if (requestsInLastSecond >= this.config.requestsPerSecond) {
        return false;
      }
    }

    // Check per-minute limit
    if (this.config.requestsPerMinute) {
      const requestsInLastMinute = this.getRequestCountInWindow(now, 60000);
      if (requestsInLastMinute >= this.config.requestsPerMinute) {
        return false;
      }
    }

    // Check per-hour limit
    if (this.config.requestsPerHour) {
      const requestsInLastHour = this.getRequestCountInWindow(now, 3600000);
      if (requestsInLastHour >= this.config.requestsPerHour) {
        return false;
      }
    }

    return true;
  }

  private cleanOldTimestamps(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // Keep up to 1 hour of history

    // Remove timestamps older than 1 hour
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! < oneHourAgo) {
      this.requestTimestamps.shift();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRequestCountInWindow(now: number, windowMs: number): number {
    const windowStart = now - windowMs;
    return this.requestTimestamps.filter((ts) => ts >= windowStart).length;
  }

  private getWaitTimeMs(): number {
    const now = Date.now();
    let maxWaitTime = 0;

    // Check per-second limit
    if (this.config.requestsPerSecond) {
      const requestsInLastSecond = this.getRequestCountInWindow(now, 1000);
      if (requestsInLastSecond >= this.config.requestsPerSecond) {
        // Find the oldest request in the last second
        const windowStart = now - 1000;
        const oldestInWindow = this.requestTimestamps.find((ts) => ts >= windowStart);
        if (oldestInWindow) {
          const waitTime = oldestInWindow + 1000 - now + 10; // Add 10ms buffer
          maxWaitTime = Math.max(maxWaitTime, waitTime);
        }
      }
    }

    // Check per-minute limit
    if (this.config.requestsPerMinute) {
      const requestsInLastMinute = this.getRequestCountInWindow(now, 60000);
      if (requestsInLastMinute >= this.config.requestsPerMinute) {
        const windowStart = now - 60000;
        const oldestInWindow = this.requestTimestamps.find((ts) => ts >= windowStart);
        if (oldestInWindow) {
          const waitTime = oldestInWindow + 60000 - now + 10;
          maxWaitTime = Math.max(maxWaitTime, waitTime);
        }
      }
    }

    // Check per-hour limit
    if (this.config.requestsPerHour) {
      const requestsInLastHour = this.getRequestCountInWindow(now, 3600000);
      if (requestsInLastHour >= this.config.requestsPerHour) {
        const windowStart = now - 3600000;
        const oldestInWindow = this.requestTimestamps.find((ts) => ts >= windowStart);
        if (oldestInWindow) {
          const waitTime = oldestInWindow + 3600000 - now + 10;
          maxWaitTime = Math.max(maxWaitTime, waitTime);
        }
      }
    }

    // Also consider token bucket rate
    if (this.tokens < 1) {
      const timeUntilNextToken = (1 / (this.config.requestsPerSecond || 1)) * 1000;
      maxWaitTime = Math.max(maxWaitTime, Math.ceil(timeUntilNextToken));
    }

    return Math.ceil(maxWaitTime);
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
