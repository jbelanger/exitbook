import fs from 'node:fs';
import os from 'node:os';

import { Inject, Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino from 'pino';

import { CorrelationService } from './correlation.service';
import { logLevelsSchema } from './environment.schema';
import { LOGGER_CONFIG, type LoggerConfig } from './logger.config';

export interface Logger extends pino.Logger<'audit'> {
  audit: pino.LogFn;
}

export interface ErrorContext {
  metadata?: Record<string, unknown>;
  module?: string;
  requestId?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly loggerCache = new Map<string, Logger>();
  private readonly rootLogger: Logger;

  constructor(
    @Inject(LOGGER_CONFIG) private readonly config: LoggerConfig,
    private readonly correlationService: CorrelationService
  ) {
    this.rootLogger = this.createRootLogger();
  }

  // --- NESTJS LOGGER INTERFACE METHODS ---
  debug?(message: unknown, context?: string) {
    const [obj, msg] = this.formatMessage(message);
    this.getLogger(context || 'Application').debug(obj, msg);
  }

  error(message: unknown, trace?: string, context?: string) {
    const logger = this.getLogger(context || 'Application');
    const [obj, msg] = this.formatMessage(message);

    // Smartly merge trace with the object if both exist
    if (typeof obj === 'object' && obj !== null) {
      logger.error({ ...obj, trace }, msg || 'Error object');
    } else {
      logger.error({ trace }, obj as string);
    }
  }

  /**
   * Enhanced error logging with structured context capture
   */
  errorWithContext(error: Error | unknown, context?: ErrorContext): void {
    const logger = this.getLogger(context?.module || 'Application');
    const correlationContext = this.correlationService.getContext();

    const errorObject = {
      context: {
        metadata: context?.metadata,
        requestId: context?.requestId,
        userId: context?.userId,
      },
      correlationId: correlationContext?.correlationId,
      error:
        error instanceof Error
          ? {
              cause: error.cause,
              message: error.message,
              name: error.name,
              stack: error.stack,
            }
          : { message: String(error) },
      fingerprint: this.generateErrorFingerprint(error),
      severity: context?.severity || this.calculateSeverity(error),
      timestamp: new Date().toISOString(),
    };

    // Add trace context if available
    if (correlationContext?.traceContext) {
      errorObject.correlationId = correlationContext.correlationId;
    }

    logger.error(errorObject);

    // Auto-escalate critical errors
    if (errorObject.severity === 'critical') {
      this.escalateError(errorObject);
    }
  }

  log(message: unknown, context?: string) {
    const [obj, msg] = this.formatMessage(message);
    this.getLogger(context || 'Application').info(obj, msg);
  }

  verbose?(message: unknown, context?: string) {
    const [obj, msg] = this.formatMessage(message);
    this.getLogger(context || 'Application').trace(obj, msg); // Map verbose to trace level
  }

  warn(message: unknown, context?: string) {
    const [obj, msg] = this.formatMessage(message);
    this.getLogger(context || 'Application').warn(obj, msg);
  }

  /**
   * Returns a logger for the specified logging category.
   * Creates a child logger from the root logger with category-specific context.
   */
  getLogger(category: string): Logger {
    if (this.loggerCache.has(category)) {
      return this.loggerCache.get(category)!;
    }

    // Child loggers only need the category context.
    // The correlationId is handled globally by the root logger's mixin.
    const categoryLogger = this.rootLogger.child({
      category,
      categoryLabel: this.formatLabel(category, 25),
    }) as Logger;

    this.loggerCache.set(category, categoryLogger);
    return categoryLogger;
  }

  /**
   * Creates and configures the root logger instance.
   */
  private createRootLogger(): Logger {
    // Ensure the log directory exists
    this.ensureLogDirExists(this.config.auditLogDirname);

    // Define a more flexible transport target type
    type TransportTarget = {
      level: string;
      options: Record<string, unknown>;
      target: string;
    };

    // Build transport targets array
    const transportTargets: TransportTarget[] = [];

    // In development, use pino-pretty for human-readable logs
    if (this.config.nodeEnv === 'development') {
      transportTargets.push({
        level: 'trace',
        options: {
          colorize: true,
          customColors: 'info:blue,error:red,warn:yellow,debug:green',
          customLevels: logLevelsSchema,
          ignore: 'pid,hostname,category,categoryLabel,service,environment,correlationId',
          levelPadding: true,
          messageFormat: '[{categoryLabel}]: {msg}',
          translateTime: 'yyyy-mm-dd HH:MM:ss.l',
          useOnlyCustomLevels: true,
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

    // Add audit log transport if enabled (same for both environments)
    if (this.config.auditLogEnabled) {
      transportTargets.push({
        level: 'audit',
        options: {
          file: `./${this.config.auditLogDirname}/${this.config.auditLogFilename}_${os.hostname()}.log`,
          frequency: 'daily',
          max: this.config.auditLogRetentionDays,
          mkdir: true,
          size: '10M',
        },
        target: 'pino-roll',
      });
    }

    // Create the Pino logger with standard configuration
    const pinoConfig: pino.LoggerOptions<'audit'> = {
      base: {
        environment: this.config.nodeEnv,
        hostname: os.hostname(),
        pid: process.pid,
        service: this.config.serviceName,
      },
      customLevels: logLevelsSchema,
      level: this.config.logLevel.toLowerCase(),
      // THIS IS THE KEY IMPROVEMENT
      // This function runs on EVERY log call, adding dynamic data.
      mixin: () => {
        const context = this.correlationService.getContext();
        if (!context) return {};

        const mixinData: Record<string, unknown> = {
          correlationId: context.correlationId,
        };

        // Add trace context if available
        if (context.traceContext) {
          mixinData.traceId = context.traceContext.traceId;
          mixinData.spanId = context.traceContext.spanId;
          if (context.traceContext.parentSpanId) {
            mixinData.parentSpanId = context.traceContext.parentSpanId;
          }
        }

        return mixinData;
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      useOnlyCustomLevels: true,
    };

    // Only add transport configuration if we have targets
    // In production with no targets, default to stdout JSON logging
    if (transportTargets.length > 0) {
      pinoConfig.transport = { targets: transportTargets };
    }

    const pinoLogger = pino.pino<'audit'>(pinoConfig);

    return pinoLogger as Logger;
  }

  /**
   * Ensures that the log directory exists; if not, it creates it.
   */
  private ensureLogDirExists(directoryPath: string): void {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  }

  /**
   * Formats a log label string to be a fixed length. When the label string
   * is longer than the specified size, it is truncated and prefixed by a
   * horizontal ellipsis (…).
   */
  private formatLabel(label: string, size: number): string {
    const string_ = label.padStart(size);
    return string_.length <= size ? string_ : `…${string_.slice(-size + 1)}`;
  }

  // Helper to handle unknown message types
  private formatMessage(message: unknown): [object | string, string?] {
    if (typeof message === 'object' && message !== null) {
      // If it's an object, pass it as the first argument to pino
      // and use a default message.
      return [message, 'Log object'];
    }
    // Otherwise, convert it to a string.
    return [String(message)];
  }

  /**
   * Calculates error severity based on error type and characteristics
   */
  private calculateSeverity(error: Error | unknown): 'low' | 'medium' | 'high' | 'critical' {
    if (!(error instanceof Error)) {
      return 'medium';
    }

    const errorName = error.name.toLowerCase();
    const errorMessage = error.message.toLowerCase();

    // Critical errors
    if (
      errorName.includes('outofmemory') ||
      errorMessage.includes('fatal') ||
      errorMessage.includes('critical') ||
      errorName.includes('systemerror')
    ) {
      return 'critical';
    }

    // High severity errors
    if (
      errorName.includes('timeout') ||
      errorName.includes('connection') ||
      errorMessage.includes('database') ||
      errorMessage.includes('network') ||
      errorName.includes('unauthorized') ||
      errorName.includes('forbidden')
    ) {
      return 'high';
    }

    // Low severity errors
    if (
      errorName.includes('validation') ||
      errorName.includes('badrequest') ||
      errorMessage.includes('invalid input') ||
      errorName.includes('notfound')
    ) {
      return 'low';
    }

    // Default to medium
    return 'medium';
  }

  /**
   * Generates a stable fingerprint for error deduplication
   */
  private generateErrorFingerprint(error: Error | unknown): string {
    if (!(error instanceof Error)) {
      return this.hashString(String(error));
    }

    // Create a stable hash based on error name and first line of stack
    const firstStackLine = error.stack?.split('\n')[1]?.trim() || '';
    const fingerprintSource = `${error.name}:${firstStackLine}`;

    return this.hashString(fingerprintSource);
  }

  /**
   * Simple hash function for generating fingerprints
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let index = 0; index < str.length; index++) {
      const char = str.charCodeAt(index);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Escalates critical errors - placeholder for integration with alerting systems
   */
  private escalateError({ fingerprint, severity }: { fingerprint: string; severity: string }): void {
    // This method is designed to be extended/overridden for specific escalation needs
    // For now, we just log the escalation
    this.rootLogger.warn(
      {
        errorFingerprint: fingerprint,
        severity,
        type: 'error_escalation',
      },
      'Critical error escalated for attention'
    );
  }
}
