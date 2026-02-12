import type { LogEntry, Sink } from './logger.js';

export interface BufferedSinkOptions {
  maxBuffer?: number;
}

/**
 * Base class for sinks that buffer log entries and flush them asynchronously.
 * This prevents blocking the main thread during hot paths (e.g., import/process loops).
 *
 * Subclasses implement `writeEntry(entry)` for actual output.
 */
export abstract class BufferedSink implements Sink {
  private buffer: LogEntry[] = [];
  private scheduled = false;
  private dropped = 0;
  private readonly maxBuffer: number;

  constructor(options?: BufferedSinkOptions) {
    this.maxBuffer = options?.maxBuffer ?? 1000;
  }

  protected abstract writeEntry(entry: LogEntry): void;

  write(entry: LogEntry): void {
    if (this.buffer.length >= this.maxBuffer) {
      this.dropped++;
      this.buffer.shift(); // drop oldest
    }
    this.buffer.push(entry);
    if (!this.scheduled) {
      this.scheduled = true;
      (globalThis.setImmediate ?? ((fn: () => void) => setTimeout(fn, 0)))(() => this.drain());
    }
  }

  /** Drain buffer synchronously. Call before process exit. */
  flush(): void {
    this.drain();
  }

  private drain(): void {
    const entries = this.buffer;
    const dropped = this.dropped;
    this.buffer = [];
    this.scheduled = false;
    this.dropped = 0;

    if (dropped > 0) {
      this.writeEntry({
        level: 'warn',
        category: 'logger',
        timestamp: new Date(),
        msg: `Dropped ${String(dropped)} log entries (buffer overflow)`,
      });
    }

    for (const entry of entries) {
      this.writeEntry(entry);
    }
  }
}
