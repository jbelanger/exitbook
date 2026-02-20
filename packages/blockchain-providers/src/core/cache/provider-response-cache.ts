/**
 * Simple TTL cache for provider responses
 *
 * Timer-based cleanup is opt-in via startAutoCleanup()/stopAutoCleanup()
 * to avoid timer leaks in tests and short-lived processes.
 */

interface CacheEntry {
  expiry: number;
  result: unknown;
}

// Provider request cache timeout: Balance between fresh data and API rate limits
// 30 seconds allows rapid successive calls to use cached results while ensuring reasonable freshness
const DEFAULT_CACHE_TIMEOUT_MS = 30_000;

export class ProviderResponseCache {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer?: NodeJS.Timeout | undefined;

  constructor(private readonly timeoutMs = DEFAULT_CACHE_TIMEOUT_MS) {}

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiry <= Date.now()) {
      // Eager eviction on read prevents stale-entry buildup when auto-cleanup is not running.
      this.cache.delete(key);
      return undefined;
    }
    return entry.result as T;
  }

  set(key: string, value: unknown): void {
    this.cache.set(key, {
      expiry: Date.now() + this.timeoutMs,
      result: value,
    });
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry <= now) {
        this.cache.delete(key);
      }
    }
  }

  startAutoCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.timeoutMs);
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  clear(): void {
    this.stopAutoCleanup();
    this.cache.clear();
  }
}
