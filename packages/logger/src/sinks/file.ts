import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { BufferedSink, type BufferedSinkOptions } from '../buffered-sink.js';
import type { LogEntry } from '../logger.js';

export interface FileSinkOptions extends BufferedSinkOptions {
  path: string;
}

/**
 * Node-only file sink that writes JSON lines to a file.
 * Uses synchronous writes to guarantee data persistence.
 * Accessed via @exitbook/logger/file subpath export.
 */
export class FileSink extends BufferedSink {
  private readonly path: string;

  constructor(options: FileSinkOptions) {
    super(options);

    // Ensure directory exists
    const dir = dirname(options.path);
    mkdirSync(dir, { recursive: true });

    this.path = options.path;
  }

  protected writeEntry(entry: LogEntry): void {
    const line = JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: entry.level,
      category: entry.category,
      msg: entry.msg,
      ...(entry.context ? { context: entry.context } : {}),
    });
    // Use sync write to guarantee persistence - BufferedSink already batches calls
    appendFileSync(this.path, line + '\n', 'utf8');
  }
}
