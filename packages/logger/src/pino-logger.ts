import fs from 'node:fs';
import os from 'node:os';
import { Writable } from 'node:stream';

import pino from 'pino';

import { logLevelsSchema, validateLoggerEnv } from './env.schema.js';

// Validate environment variables (reads NODE_ENV directly from process.env)
const env = validateLoggerEnv(process.env);

/**
 * Formats a log label string to be a fixed length. When the label string
 * is longer than the specified size, it is truncated and prefixed by a
 * horizontal ellipsis (…).
 */
function formatLabel(label: string, size: number): string {
  const str = label.padStart(size);
  return str.length <= size ? str : `…${str.slice(-size + 1)}`;
}

// Our Logger type extending Pino's base logger type
export interface Logger extends pino.Logger<'audit'> {
  audit: pino.LogFn;
}

// Cache for loggers
const loggerCache = new Map<string, Logger>();

// Root logger instance
let rootLogger: Logger | undefined;

interface TransportMode {
  console: boolean;
  file: boolean;
}

// Mutable transport settings so CLI can toggle console/file outputs at runtime
let transportMode: TransportMode = {
  console: env.LOGGER_CONSOLE_ENABLED,
  file: env.LOGGER_FILE_LOG_ENABLED,
};

/**
 * Ensures that the log directory exists; if not, it creates it.
 */
function ensureLogDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Creates and configures the root logger instance.
 */
function createRootLogger(): Logger {
  // Ensure the log directory exists
  ensureLogDirExists(env.LOGGER_AUDIT_LOG_DIRNAME);

  // Define a more flexible transport target type
  interface TransportTarget {
    level: string;
    options: Record<string, unknown>;
    target: string;
  }

  // Build transport targets array
  const transportTargets: TransportTarget[] = [];

  // Skip all transports in test environment to avoid spawning worker threads
  // Check both the validated env and process.env (in case vitest sets it after module load)
  const isTestEnv = env.NODE_ENV === 'test' || process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true';

  // In development, use pino-pretty for human-readable logs
  if (transportMode.console && !isTestEnv) {
    if (env.NODE_ENV === 'development') {
      transportTargets.push({
        level: 'trace',
        options: {
          ignore: 'pid,hostname,category,categoryLabel,service,environment,correlationId',
        },
        target: 'pino-pretty',
      });
    } else {
      // In production, explicitly add a transport for stdout
      // This ensures logs go to container stdout in JSON format
      transportTargets.push({
        level: 'trace',
        options: {
          destination: 1, // stdout file descriptor
          // No additional formatting - pure JSON for log processors
        },
        target: 'pino/file',
      });
    }
  }

  // Optional file log for non-audit structured output (JSON)
  if (transportMode.file && !isTestEnv) {
    transportTargets.push({
      level: 'trace',
      options: {
        destination: `./${env.LOGGER_AUDIT_LOG_DIRNAME}/${env.LOGGER_FILE_LOG_FILENAME}`,
        mkdir: true,
      },
      target: 'pino/file',
    });
  }

  // Add audit log transport if enabled (same for both environments)
  if (env.LOGGER_AUDIT_LOG_ENABLED && !isTestEnv) {
    transportTargets.push({
      level: 'audit',
      options: {
        file: `./${env.LOGGER_AUDIT_LOG_DIRNAME}/${env.LOGGER_AUDIT_LOG_FILENAME}_${os.hostname()}.log`,
        frequency: 'daily',
        max: env.LOGGER_AUDIT_LOG_RETENTION_DAYS,
        mkdir: true,
        size: '10M',
      },
      target: 'pino-roll',
    });
  }

  // Create the Pino logger with standard configuration
  const pinoConfig: pino.LoggerOptions<'audit'> = {
    base: {
      environment: env.NODE_ENV,
      hostname: os.hostname(),
      pid: process.pid,
      service: env.LOGGER_SERVICE_NAME,
    },
    customLevels: logLevelsSchema,
    level: env.LOGGER_LOG_LEVEL.toLowerCase(),
    timestamp: pino.stdTimeFunctions.isoTime,
    useOnlyCustomLevels: true,
  };

  let pinoLogger: pino.Logger<'audit'>;

  // In test mode, use a noop stream to completely suppress all output
  if (isTestEnv) {
    const noopStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    pinoLogger = pino.pino<'audit'>(pinoConfig, noopStream);
  } else {
    // Only set transport if we have targets (avoids spawning workers in test mode)
    if (transportTargets.length > 0) {
      pinoConfig.transport = { targets: transportTargets };
    }
    pinoLogger = pino.pino<'audit'>(pinoConfig);
  }

  return pinoLogger as Logger;
}

/**
 * Internal: get or create the underlying pino logger for a category.
 * Callers should prefer the proxy returned by getLogger below so
 * transport reconfiguration (setLoggerTransports) is respected even
 * for previously created loggers.
 */
function getOrCreateCategoryLogger(category: string): Logger {
  if (loggerCache.has(category)) return loggerCache.get(category)!;

  if (!rootLogger) {
    rootLogger = createRootLogger();
  }

  const categoryLogger = rootLogger.child(
    {
      category,
      categoryLabel: formatLabel(category, 25),
    },
    { level: env.LOGGER_LOG_LEVEL.toLowerCase() }
  ) as Logger;

  loggerCache.set(category, categoryLogger);

  return categoryLogger;
}

/**
 * Returns a category logger that stays in sync with transport reconfiguration.
 *
 * We return a Proxy that looks up the latest underlying pino logger on every
 * property access. This ensures calls made after `setLoggerTransports(...)`
 * use the new transports even if the caller captured the logger before
 * reconfiguration (common when modules create loggers at top-level).
 */
export const getLogger = (category: string): Logger => {
  return new Proxy({} as Logger, {
    get: (_target, prop) => {
      const logger = getOrCreateCategoryLogger(category);
      const value = logger[prop as keyof Logger];
      return typeof value === 'function' ? value.bind(logger) : value;
    },
  });
};

/**
 * Update transport mode at runtime (used by clack-logger to suppress console in JSON mode).
 * Resets cached loggers so new configuration applies immediately.
 */
export function setLoggerTransports(next: Partial<TransportMode>): void {
  transportMode = { ...transportMode, ...next };
  rootLogger = undefined;
  loggerCache.clear();
}
