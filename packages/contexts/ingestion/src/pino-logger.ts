import {
  logInfo,
  logError,
  logWarning,
  logDebug,
  StructuredLoggerLive,
} from '@exitbook/platform-monitoring';
import { Effect } from 'effect';

// Maintain compatibility with existing Pino Logger interface
export interface Logger {
  audit: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
  child: (bindings: Record<string, unknown>) => Logger;
  debug: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
  error: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
  info: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
  trace: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
  warn: (
    messageOrObj: string | Record<string, unknown>,
    message?: string,
    ...args: unknown[]
  ) => void;
}

/**
 * Formats a log label string to be a fixed length. When the label string
 * is longer than the specified size, it is truncated and prefixed by a
 * horizontal ellipsis (…).
 */
function formatLabel(label: string, size: number): string {
  const str = label.padStart(size);
  return str.length <= size ? str : `…${str.slice(-size + 1)}`;
}

// Cache for loggers
const loggerCache = new Map<string, Logger>();

/**
 * Creates a logger adapter that bridges Pino-style logging to Effect Logger
 */
function createEffectLoggerAdapter(
  category: string,
  bindings: Record<string, unknown> = {},
): Logger {
  const categoryLabel = formatLabel(category, 25);

  const createLogMethod =
    (effectLogFn: typeof logInfo) =>
    (messageOrObj: string | Record<string, unknown>, message?: string, ...args: unknown[]) => {
      // Handle Pino-style logging: logger.error(obj, message) or logger.error(message)
      let finalMessage: string;
      let finalAttributes: Record<string, unknown>;

      if (typeof messageOrObj === 'string') {
        // Simple case: logger.error("message")
        finalMessage = `[${categoryLabel}] ${messageOrObj}`;
        finalAttributes = {
          category,
          categoryLabel,
          ...bindings,
          ...(args.length > 0 && typeof args[0] === 'object'
            ? (args[0] as Record<string, unknown>)
            : {}),
        };
      } else {
        // Pino case: logger.error(obj, "message")
        finalMessage = `[${categoryLabel}] ${message || 'Log message'}`;
        finalAttributes = {
          category,
          categoryLabel,
          ...bindings,
          ...messageOrObj,
        };
      }

      // Run the Effect synchronously for compatibility
      try {
        Effect.runSync(
          effectLogFn(finalMessage, finalAttributes).pipe(
            Effect.provide(StructuredLoggerLive),
          ) as Effect.Effect<void, never, never>,
        );
      } catch (error) {
        console.error('Logger error:', error);
      }
    };

  return {
    audit: createLogMethod(logInfo), // Map audit to info for now
    child: (childBindings: Record<string, unknown>) =>
      createEffectLoggerAdapter(category, { ...bindings, ...childBindings }),
    debug: createLogMethod(logDebug),
    error: createLogMethod(logError),
    info: createLogMethod(logInfo),
    trace: createLogMethod(logDebug), // Map trace to debug

    warn: createLogMethod(logWarning),
  };
}

/**
 * Returns a logger for the specified logging category.
 * Creates an Effect-based logger with Pino-compatible interface.
 */
export const getLogger = (category: string): Logger => {
  if (loggerCache.has(category)) {
    return loggerCache.get(category)!;
  }

  const logger = createEffectLoggerAdapter(category);
  loggerCache.set(category, logger);

  return logger;
};
