import { getLogger as getPinoLogger, type Logger } from './pino-logger.js';

// Re-export Logger type
export type { Logger } from './pino-logger.js';

/**
 * Spinner interface (compatible with @clack/prompts).
 */
export interface Spinner {
  message: (msg: string) => void;
  start: (msg?: string) => void;
  stop: (msg?: string) => void;
}

/**
 * Logger context for configuring global logger behavior.
 */
export interface LoggerContext {
  /** Active spinner to route logs to */
  spinner?: Spinner | undefined;
  /** Output mode (text shows spinner, json skips it) */
  mode?: 'text' | 'json' | undefined;
  /** Verbose mode (shows debug logs on spinner) */
  verbose?: boolean | undefined;
}

/**
 * Global logger context - configurable at runtime.
 */
let globalContext: LoggerContext = {};

/**
 * Configure the global logger context.
 * Call this at the start of CLI commands to enable spinner integration.
 *
 * @example
 * ```typescript
 * const spinner = output.spinner();
 * spinner?.start('Importing data...');
 *
 * configureLogger({ spinner, mode: 'text', verbose: options.verbose });
 *
 * // All getLogger() calls now route to spinner automatically!
 * const result = await handler.execute(params);
 *
 * spinner?.stop('Import complete');
 * resetLoggerContext();
 * ```
 */
export function configureLogger(context: LoggerContext): void {
  globalContext = { ...context };
}

/**
 * Reset logger context to defaults.
 * Useful for tests and cleanup after commands.
 */
export function resetLoggerContext(): void {
  globalContext = {};
}

/**
 * Get current logger context.
 * Primarily for testing and debugging.
 */
export function getLoggerContext(): Readonly<LoggerContext> {
  return { ...globalContext };
}

/**
 * Enhanced getLogger that respects global context.
 * Drop-in replacement for the existing getLogger from pino-logger.
 *
 * When a spinner is active in text mode, logs are routed to the spinner.
 * Otherwise, logs go to pino as normal.
 */
export function getLogger(category: string): Logger {
  const pinoLogger = getPinoLogger(category);

  // If we have a spinner in text mode, wrap the logger
  if (globalContext.spinner && globalContext.mode === 'text') {
    return createSpinnerAwareLogger(pinoLogger, globalContext);
  }

  return pinoLogger;
}

/**
 * Wraps a pino logger to route output to spinner when appropriate.
 * Uses Proxy to intercept logging method calls.
 */
function createSpinnerAwareLogger(pinoLogger: Logger, context: LoggerContext): Logger {
  const spinner = context.spinner!;
  const verbose = context.verbose || false;

  return new Proxy(pinoLogger, {
    get: (target, prop: string) => {
      // Intercept info() calls
      if (prop === 'info') {
        return (msgOrObj: object | string, msg?: string) => {
          // Always log to pino (for files, audit)
          // Call with correct signature based on arguments
          if (typeof msgOrObj === 'string') {
            target.info(msgOrObj);
          } else {
            target.info(msgOrObj, msg);
          }

          // Extract message
          const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';

          // Update spinner
          if (message) {
            spinner.message(message);
          }
        };
      }

      // Intercept warn() calls
      if (prop === 'warn') {
        return (msgOrObj: object | string, msg?: string) => {
          if (typeof msgOrObj === 'string') {
            target.warn(msgOrObj);
          } else {
            target.warn(msgOrObj, msg);
          }

          const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
          if (message) {
            spinner.message(`⚠️  ${message}`);
          }
        };
      }

      // Intercept error() calls
      if (prop === 'error') {
        return (msgOrObj: object | string, msg?: string) => {
          if (typeof msgOrObj === 'string') {
            target.error(msgOrObj);
          } else {
            target.error(msgOrObj, msg);
          }

          const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
          if (message) {
            spinner.message(`❌ ${message}`);
          }
        };
      }

      // Intercept debug() calls
      if (prop === 'debug') {
        return (msgOrObj: object | string, msg?: string) => {
          if (typeof msgOrObj === 'string') {
            target.debug(msgOrObj);
          } else {
            target.debug(msgOrObj, msg);
          }

          // Only show debug on spinner in verbose mode
          if (verbose) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              spinner.message(`[DEBUG] ${message}`);
            }
          }
        };
      }

      // Intercept child() calls to wrap child loggers too
      if (prop === 'child') {
        return (bindings: object, options?: object) => {
          const childLogger = target.child(bindings, options);
          // Wrap child logger with same context
          return createSpinnerAwareLogger(childLogger, context);
        };
      }

      // Pass through everything else (level, trace, fatal, etc.)
      return target[prop as keyof Logger];
    },
  });
}
