/**
 * Simple TTL cache for provider responses
 *
 * Timer-based cleanup is opt-in via startAutoCleanup()/stopAutoCleanup()
 * to avoid timer leaks in tests and short-lived processes.
 *
 * Uses ReturnType<typeof setInterval> instead of NodeJS.Timeout
 * for runtime portability (Node, Bun, browsers).
 */

interface CacheEntry {
  expiry: number;
  result: unknown;
}

const DEFAULT_TTL_MS = 30_000;

export class TtlCache {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer?: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiry <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result as T;
  }

  set(key: string, value: unknown): void {
    this.cache.set(key, {
      expiry: Date.now() + this.ttlMs,
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
    this.cleanupTimer = setInterval(() => this.cleanup(), this.ttlMs);
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
