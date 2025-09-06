/**
 * NestJS-compatible logger services using Pino to avoid Winston's DailyRotateFile
 * transport event listener limits when audit logging is enabled.
 * Also provides correlation ID tracking for request tracing.
 */

// Export NestJS module
export { LoggerModule, type LoggerModuleAsyncOptions } from './logger.module';

// Export NestJS services
export { CorrelationService, type TraceContext, type CorrelationContext } from './correlation.service';
export { LoggerService, type Logger, type ErrorContext } from './logger.service';

// Export configuration
export { LOGGER_CONFIG, type LoggerConfig, validateLoggerConfig } from './logger.config';

// Export environment schema
export { loggerEnvironmentSchema, validateLoggerEnvironment } from './environment.schema';
