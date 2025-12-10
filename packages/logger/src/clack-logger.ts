/**
 * Logger Factory with Clack Integration
 *
 * This module provides a drop-in replacement for pino-logger that integrates seamlessly
 * with @clack/prompts to create a beautiful, cohesive CLI experience.
 *
 * ## Design Philosophy
 *
 * ### 1. Progressive Disclosure
 * Logs are ONLY shown when a spinner is active. This prevents visual clutter and ensures
 * users see information at the right time (during active operations, not after).
 *
 * ### 2. Visual Consistency with Clack
 * Uses clack's box-drawing characters (◆, │, └) and formatting to create a unified tree
 * structure throughout the CLI. Logs appear as indented, dimmed lines within the tree:
 *
 * ```
 * ◆  Importing data...
 * │  Fetching transactions from API
 * │  Processing 100 items
 * │  ⚠️  Rate limit warning
 * └  Import complete - 100 items, session: 42
 * ```
 *
 * ### 3. Direct stderr Integration (Not spinner.message())
 * We write DIRECTLY to stderr instead of using spinner.message() because:
 * - Clack's spinner uses box-drawing characters and we need to match that format
 * - Direct writes give us precise control over ANSI codes and formatting
 * - We can clear the spinner line, write our log, and let clack redraw
 * - Logs appear as part of the tree structure, not spinner updates
 *
 * ### 4. Context-Aware at Log Time
 * The logger checks global context when log methods are called (not when logger is created).
 * This allows dynamic behavior:
 * - Logs during spinner → styled tree output
 * - Logs after spinner → suppressed (progressive disclosure)
 * - JSON mode → all logs suppressed (only structured JSON output)
 *
 * ## ANSI Formatting Reference
 *
 * - `\r\x1b[K` - Clear current line (removes spinner animation)
 * - `\x1b[2m`  - Dim text (for subtle info logs)
 * - `\x1b[33m` - Yellow text (for warnings)
 * - `\x1b[31m` - Red text (for errors)
 * - `\x1b[0m`  - Reset formatting
 * - `│  `      - Clack box-drawing character + padding
 *
 * ## Usage Pattern
 *
 * ```typescript
 * // In CLI command handler:
 * const spinner = output.spinner();
 * spinner?.start('Importing data...');
 *
 * // Configure logger to route to spinner
 * configureLogger({
 *   spinner,
 *   mode: 'text',
 *   verbose: options.verbose,
 *   sinks: { ui: true, structured: 'off' }, // UI-only while spinner active
 * });
 *
 * // All getLogger() calls now write to stderr with clack formatting
 * const logger = getLogger('importer');
 * logger.info('Fetching transactions from API');  // → │  Fetching transactions from API
 * logger.warn('Rate limit warning');             // → │  ⚠️  Rate limit warning
 *
 * spinner?.stop('Import complete');
 * resetLoggerContext(); // Clean up
 * ```
 *
 * @see {@link https://github.com/natemoo-re/clack @clack/prompts documentation}
 */

import { getLogger as getPinoLogger, setLoggerTransports, type Logger } from './pino-logger.js';

// Re-export Logger type
export type { Logger } from './pino-logger.js';

/**
 * Spinner interface (compatible with @clack/prompts).
 * Note: We don't actually use spinner.message() - we write directly to stderr instead.
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
  /** Active spinner (presence indicates logs should be displayed) */
  spinner?: Spinner | undefined;
  /** Output mode (text enables clack formatting, json suppresses all logs) */
  mode?: 'text' | 'json' | undefined;
  /** Verbose mode (shows debug logs with [DEBUG] prefix) */
  verbose?: boolean | undefined;
  /** Sink selection to avoid duplicate console + UI output */
  sinks?: {
    /**
     * Structured sink destination.
     * 'stdout' forwards to console transports (default).
     * 'file' forwards to file transport only.
     * 'off' keeps UI-only to avoid clack + console dupes.
     */
    structured?: 'stdout' | 'file' | 'off' | undefined;
    /** Whether to emit UI/clack lines (default: true when spinner + text mode) */
    ui?: boolean | undefined;
  };
}

/**
 * Global logger context - configurable at runtime.
 * Checked at log time (not logger creation time) for dynamic behavior.
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

  const structured = globalContext.sinks?.structured ?? 'stdout';
  if (structured === 'off') {
    setLoggerTransports({ console: false, file: false });
  } else if (structured === 'file') {
    setLoggerTransports({ console: false, file: true });
  } else {
    // stdout (default) - respect existing file setting from env/config
    setLoggerTransports({ console: true });
  }
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
  // Always wrap the logger - context is checked at log time
  return createSpinnerAwareLogger(category);
}

/**
 * Wraps a pino logger to integrate with clack's visual tree structure.
 *
 * ## How It Works
 *
 * 1. **Proxy Pattern**: Intercepts log method calls (info, warn, error, debug)
 * 2. **Context Check**: At log time, checks if spinner is active and mode is 'text'
 * 3. **Direct stderr Write**: Writes formatted output directly to stderr with:
 *    - Line clear (`\r\x1b[K`) to remove spinner animation
 *    - Clack box character (`│  `) for tree structure
 *    - ANSI color codes for visual hierarchy
 *    - Message text
 *    - Reset code to prevent color bleed
 * 4. **Progressive Disclosure**: Suppresses logs when no spinner is active
 *
 * ## Method Interception
 *
 * - **info()**: Dimmed text with `│  ` prefix
 * - **warn()**: Yellow text with `│  ⚠️  ` prefix
 * - **error()**: Red text with `│  ❌ ` prefix
 * - **debug()**: Dimmed text with `│  [DEBUG] ` prefix (only in verbose mode)
 * - **child()**: Wraps child loggers recursively
 *
 * ## Pino Signature Compatibility
 *
 * Supports both pino calling conventions:
 * - `logger.info('message')` - String message
 * - `logger.info({ metadata }, 'message')` - Object + message
 *
 * For display, we only use the message string. Metadata is ignored for console output
 * but could be logged to files via pino if needed in the future.
 *
 * @param pinoLogger - The underlying pino logger instance
 * @returns Proxied logger with clack integration
 */
function createSpinnerAwareLogger(category: string): Logger {
  return new Proxy({} as Logger, {
    get: (_target, prop: string) => {
      const target = getPinoLogger(category);
      const isUiEnabled = (): boolean => {
        const sinks = globalContext.sinks ?? {};
        const uiEnabled = sinks.ui ?? true;
        return globalContext.spinner !== undefined && globalContext.mode === 'text' && uiEnabled;
      };

      const isStructuredEnabled = (): boolean => {
        const sinks = globalContext.sinks ?? {};
        return (sinks.structured ?? 'stdout') !== 'off';
      };

      // Intercept info() calls - standard informational logs
      if (prop === 'info') {
        return (msgOrObj: object | string, msg?: string) => {
          // Only show logs when spinner is active (progressive disclosure)
          if (isUiEnabled()) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              // Clear spinner line (\r\x1b[K), write log with clack box prefix (│  ), reset colors (\x1b[0m)
              process.stderr.write('\r\x1b[K');
              process.stderr.write(`\x1b[2m│  ${message}\x1b[0m\n`);
            }
          }

          // Forward to structured sink unless disabled
          if (isStructuredEnabled()) {
            if (typeof msgOrObj === 'string') {
              target.info(msgOrObj);
            } else if (msg) {
              target.info(msgOrObj, msg);
            } else {
              target.info(msgOrObj);
            }
          }
        };
      }

      // Intercept warn() calls - important notices that aren't errors
      if (prop === 'warn') {
        return (msgOrObj: object | string, msg?: string) => {
          if (isUiEnabled()) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              // Yellow color (\x1b[33m) for warnings with ⚠️  icon for visual distinction
              process.stderr.write(`\x1b[33m│  ⚠️  ${message}\x1b[0m\n`);
            }
          }

          if (isStructuredEnabled()) {
            if (typeof msgOrObj === 'string') {
              target.warn(msgOrObj);
            } else if (msg) {
              target.warn(msgOrObj, msg);
            } else {
              target.warn(msgOrObj);
            }
          }
        };
      }

      // Intercept error() calls - critical failures requiring attention
      if (prop === 'error') {
        return (msgOrObj: object | string, msg?: string) => {
          if (isUiEnabled()) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              // Red color (\x1b[31m) for errors with ❌ icon for immediate recognition
              process.stderr.write(`\x1b[31m│  ❌ ${message}\x1b[0m\n`);
            }
          }

          if (isStructuredEnabled()) {
            if (typeof msgOrObj === 'string') {
              target.error(msgOrObj);
            } else if (msg) {
              target.error(msgOrObj, msg);
            } else {
              target.error(msgOrObj);
            }
          }
        };
      }

      // Intercept debug() calls - verbose diagnostic information
      if (prop === 'debug') {
        return (msgOrObj: object | string, msg?: string) => {
          // Only show debug in verbose mode when spinner is active
          // This prevents noisy output unless user explicitly requests it via --verbose flag
          if (isUiEnabled() && globalContext.verbose) {
            const message = typeof msgOrObj === 'string' ? msgOrObj : msg || '';
            if (message) {
              process.stderr.write('\r\x1b[K');
              // Dimmed with [DEBUG] prefix to distinguish from regular info logs
              process.stderr.write(`\x1b[2m│  [DEBUG] ${message}\x1b[0m\n`);
            }
          }

          if (isStructuredEnabled()) {
            if (typeof msgOrObj === 'string') {
              target.debug(msgOrObj);
            } else if (msg) {
              target.debug(msgOrObj, msg);
            } else {
              target.debug(msgOrObj);
            }
          }
        };
      }

      // Intercept child() calls to ensure child loggers also get clack integration
      if (prop === 'child') {
        return (bindings: object, options?: object) => {
          const childLogger = target.child(bindings, options);
          // Recursively wrap child logger so it inherits clack formatting
          return createSpinnerAwareLogger(childLogger);
        };
      }

      // Pass through everything else (level, trace, fatal, bindings, etc.)
      // This ensures full Logger interface compatibility
      return target[prop as keyof Logger];
    },
  });
}
