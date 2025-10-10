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
 * When a spinner is active in text mode, logs are shown as indented/dimmed text.
 * Otherwise, logs go to pino as normal.
 *
 * IMPORTANT: Always wraps the logger so context changes are respected at log time,
 * not at logger creation time.
 */
export function getLogger(category: string): Logger {
  const pinoLogger = getPinoLogger(category);

  // Always wrap the logger - context is checked at log time
  return createSpinnerAwareLogger(pinoLogger);
}

/**
 * Wraps a pino logger to display logs as indented, dimmed text when spinner is active.
 * Uses Proxy to intercept logging method calls.
 * Checks global context at log time for dynamic behavior.
 *
 * When spinner is NOT active, logs are suppressed (progressive disclosure pattern).
 */
function createSpinnerAwareLogger(pinoLogger: Logger): Logger {
  return new Proxy(pinoLogger, {
    get: (target, prop: string) => {
      // Intercept info() calls
      if (prop === 'info') {
        return (msgOrObj: object | string, msg?: string) => {
          const isSpinnerActive = globalContext.spinner && globalContext.mode === 'text';

          // Only show logs when spinner is active
          if (isSpinnerActive) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              // Clear spinner line, write log with clack box prefix
              process.stderr.write('\r\x1b[K');
              process.stderr.write(`\x1b[2m│  ${message}\x1b[0m\n`);
            }
          }
          // Otherwise suppress (no output)
        };
      }

      // Intercept warn() calls
      if (prop === 'warn') {
        return (msgOrObj: object | string, msg?: string) => {
          const isSpinnerActive = globalContext.spinner && globalContext.mode === 'text';

          if (isSpinnerActive) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              process.stderr.write(`\x1b[2m│  ⚠️  ${message}\x1b[0m\n`);
            }
          }
          // Otherwise suppress
        };
      }

      // Intercept error() calls
      if (prop === 'error') {
        return (msgOrObj: object | string, msg?: string) => {
          const isSpinnerActive = globalContext.spinner && globalContext.mode === 'text';

          if (isSpinnerActive) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              process.stderr.write(`\x1b[2m│  ❌ ${message}\x1b[0m\n`);
            }
          }
          // Otherwise suppress
        };
      }

      // Intercept debug() calls
      if (prop === 'debug') {
        return (msgOrObj: object | string, msg?: string) => {
          const isSpinnerActive = globalContext.spinner && globalContext.mode === 'text';

          // Only show debug in verbose mode when spinner is active
          if (isSpinnerActive && globalContext.verbose) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              process.stderr.write(`\x1b[2m│  [DEBUG] ${message}\x1b[0m\n`);
            }
          }
          // Otherwise suppress
        };
      }

      // Intercept child() calls to wrap child loggers too
      if (prop === 'child') {
        return (bindings: object, options?: object) => {
          const childLogger = target.child(bindings, options);
          // Wrap child logger too
          return createSpinnerAwareLogger(childLogger);
        };
      }

      // Pass through everything else (level, trace, fatal, etc.)
      return target[prop as keyof Logger];
    },
  });
}
