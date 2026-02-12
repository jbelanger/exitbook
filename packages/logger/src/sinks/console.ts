import { BufferedSink, type BufferedSinkOptions } from '../buffered-sink.js';
import type { LogEntry } from '../logger.js';

export interface ConsoleSinkOptions extends BufferedSinkOptions {
  color?: boolean;
}

/**
 * Universal console sink that works in both Node.js and React Native.
 * No Node-specific imports.
 *
 * Format: [HH:MM:SS] LEVEL [category] message {context}
 */
export class ConsoleSink extends BufferedSink {
  private readonly color: boolean;

  constructor(options?: ConsoleSinkOptions) {
    super(options);
    this.color = options?.color ?? false;
  }

  protected writeEntry(entry: LogEntry): void {
    const time = this.formatTime(entry.timestamp);
    const level = this.formatLevel(entry.level);
    const category = `[${entry.category}]`;
    const context = entry.context ? ` ${this.formatContext(entry.context)}` : '';

    const message = `${time} ${level} ${category} ${entry.msg}${context}`;

    // Map error/warn to console.error/console.warn, rest to console.log
    if (entry.level === 'error') {
      console.error(message);
    } else if (entry.level === 'warn') {
      console.warn(message);
    } else {
      console.log(message);
    }
  }

  private formatTime(timestamp: Date): string {
    const hours = String(timestamp.getHours()).padStart(2, '0');
    const minutes = String(timestamp.getMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getSeconds()).padStart(2, '0');
    return `[${hours}:${minutes}:${seconds}]`;
  }

  private formatLevel(level: string): string {
    const upper = level.toUpperCase().padEnd(5);
    if (!this.color) return upper;

    // ANSI color codes
    switch (level) {
      case 'trace':
        return `\x1b[90m${upper}\x1b[0m`; // gray
      case 'debug':
        return `\x1b[36m${upper}\x1b[0m`; // cyan
      case 'info':
        return `\x1b[32m${upper}\x1b[0m`; // green
      case 'warn':
        return `\x1b[33m${upper}\x1b[0m`; // yellow
      case 'error':
        return `\x1b[31m${upper}\x1b[0m`; // red
      default:
        return upper;
    }
  }

  private formatContext(context: Record<string, unknown>): string {
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(context)) {
      pairs.push(`${key}=${JSON.stringify(value)}`);
    }
    return `{${pairs.join(', ')}}`;
  }
}
