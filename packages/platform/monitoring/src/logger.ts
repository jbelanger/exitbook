import { trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { Logger, Effect } from 'effect';

// Structured Logger with Trace Correlation
const createStructuredLogger = () => {
  const formatLog = (level: string, message: unknown, span?: Span): string => {
    const timestamp = new Date().toISOString();

    // Extract trace context from current span
    const traceContext: Record<string, string> = {};
    if (span) {
      const spanContext = span.spanContext();
      if (spanContext?.traceId && spanContext?.spanId) {
        traceContext['trace_id'] = spanContext.traceId;
        traceContext['span_id'] = spanContext.spanId;
        traceContext['trace_flags'] = spanContext.traceFlags?.toString() || '01';
      }
    }

    const logEntry = {
      '@timestamp': timestamp,
      environment: process.env['NODE_ENV'] || 'development',
      level: level.toLowerCase(),
      message: typeof message === 'string' ? message : JSON.stringify(message),
      service: process.env['SERVICE_NAME'] || 'exitbook',
      ...traceContext,
    };

    return JSON.stringify(logEntry);
  };

  return Logger.make(({ logLevel, message }) => {
    // Get current active span for trace correlation
    const currentSpan = trace.getActiveSpan();
    const formattedLog = formatLog(logLevel.label, message, currentSpan);

    // Output to stdout/stderr based on log level
    if (logLevel.label === 'ERROR' || logLevel.label === 'FATAL') {
      console.error(formattedLog);
    } else {
      console.log(formattedLog);
    }
  });
};

export const StructuredLoggerLive = Logger.replace(Logger.defaultLogger, createStructuredLogger());

// Logger utilities for common logging patterns with trace correlation
export const logWithTrace = <R>(
  message: string,
  attributes?: Record<string, unknown>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const currentSpan = trace.getActiveSpan();
    const logData = {
      message,
      ...(attributes && { ...attributes }),
      ...(currentSpan && {
        span_id: currentSpan.spanContext().spanId,
        trace_id: currentSpan.spanContext().traceId,
      }),
    };

    yield* Effect.log(logData);
  });

export const logInfo = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('info'));

export const logError = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('error'));

export const logWarning = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('warning'));

export const logDebug = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('debug'));
