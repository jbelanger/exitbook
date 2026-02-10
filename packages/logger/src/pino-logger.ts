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

export type Logger = pino.Logger;

// Cache for loggers
const loggerCache = new Map<string, Logger>();

// Root logger instance
let rootLogger: Logger | undefined;

/**
 * Creates and configures the root logger instance.
 */
function createRootLogger(): Logger {
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
  if (env.LOGGER_CONSOLE_ENABLED && !isTestEnv) {
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
      transportTargets.push({
        level: 'trace',
        options: {
          destination: 1, // stdout file descriptor
        },
        target: 'pino/file',
      });
    }
  }

  // Optional file log for structured output (JSON)
  if (env.LOGGER_FILE_LOG_ENABLED && !isTestEnv) {
    transportTargets.push({
      level: 'trace',
      options: {
        destination: `./${env.LOGGER_LOG_DIRNAME}/${env.LOGGER_FILE_LOG_FILENAME}`,
        mkdir: true,
      },
      target: 'pino/file',
    });
  }

  // Create the Pino logger with standard configuration
  const pinoConfig: pino.LoggerOptions = {
    base: {
      environment: env.NODE_ENV,
      service: env.LOGGER_SERVICE_NAME,
    },
    customLevels: logLevelsSchema,
    level: env.LOGGER_LOG_LEVEL.toLowerCase(),
    timestamp: pino.stdTimeFunctions.isoTime,
    useOnlyCustomLevels: true,
  };

  let pinoLogger: pino.Logger;

  // In test mode, use a noop stream to completely suppress all output
  if (isTestEnv) {
    const noopStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    pinoLogger = pino.pino(pinoConfig, noopStream);
  } else if (transportTargets.length > 0) {
    // Only set transport if we have targets (avoids spawning workers in test mode)
    pinoConfig.transport = { targets: transportTargets };
    pinoLogger = pino.pino(pinoConfig);
  } else {
    // No transports enabled - use a noop stream to suppress all output
    const noopStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    pinoLogger = pino.pino(pinoConfig, noopStream);
  }

  return pinoLogger;
}

/**
 * Get or create the underlying pino logger for a category.
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
  );

  loggerCache.set(category, categoryLogger);

  return categoryLogger;
}

/**
 * Returns a category logger for the given name.
 */
export const getLogger = (category: string): Logger => {
  return getOrCreateCategoryLogger(category);
};
