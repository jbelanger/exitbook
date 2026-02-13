export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;
  timestamp: Date;
  msg: string;
  context?: Record<string, unknown>;
}

export interface Sink {
  write(entry: LogEntry): void;
  flush(): void;
}

export interface Logger {
  trace(msg: string): void;
  trace(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface LoggerConfig {
  level?: LogLevel;
  sinks?: Sink[];
}

const levelOrder: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/**
 * Safely serialize context objects for logging.
 * Handles Error objects, circular references, BigInt, and non-serializable values.
 * Note: shared object references (same object at multiple keys) are treated as circular.
 */
function serializeContext(obj: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet();

  const replacer = (_key: string, value: unknown): unknown => {
    // Handle Error objects
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    // Handle BigInt
    if (typeof value === 'bigint') {
      return value.toString();
    }

    // Handle circular references
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }

    return value;
  };

  try {
    const serialized = JSON.parse(JSON.stringify(obj, replacer)) as Record<string, unknown>;
    return serialized;
  } catch {
    return { error: '[unserializable]' };
  }
}

class LoggerImpl implements Logger {
  constructor(private readonly category: string) {}

  trace(msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    this.log('trace', msgOrObj, maybeMsg);
  }

  debug(msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    this.log('debug', msgOrObj, maybeMsg);
  }

  info(msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    this.log('info', msgOrObj, maybeMsg);
  }

  warn(msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    this.log('warn', msgOrObj, maybeMsg);
  }

  error(msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    this.log('error', msgOrObj, maybeMsg);
  }

  private shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[globalConfig.level];
  }

  private log(level: LogLevel, msgOrObj: string | Record<string, unknown>, maybeMsg?: string): void {
    if (!this.shouldLog(level)) return;

    let msg: string;
    let context: Record<string, unknown> | undefined;

    if (typeof msgOrObj === 'string') {
      msg = msgOrObj;
    } else {
      msg = maybeMsg!;
      context = serializeContext(msgOrObj);
    }

    const entry: LogEntry = {
      level,
      category: this.category,
      timestamp: new Date(),
      msg,
      ...(context ? { context } : {}),
    };

    for (const sink of globalConfig.sinks) {
      sink.write(entry);
    }
  }
}

// Global logger state
let globalConfig: Required<LoggerConfig> = {
  level: 'info',
  sinks: [],
};

const loggerCache = new Map<string, Logger>();

export function initLogger(config: LoggerConfig): void {
  globalConfig = {
    level: config.level ?? 'info',
    sinks: config.sinks ?? [],
  };
  loggerCache.clear();
}

export function getLogger(category: string): Logger {
  if (loggerCache.has(category)) {
    return loggerCache.get(category)!;
  }

  const logger = new LoggerImpl(category);
  loggerCache.set(category, logger);
  return logger;
}

export function flushLoggers(): void {
  for (const sink of globalConfig.sinks) {
    sink.flush();
  }
}
