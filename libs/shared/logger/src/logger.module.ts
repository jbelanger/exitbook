import { DynamicModule, Global, Module } from '@nestjs/common';

import { CorrelationService } from './correlation.service';
import { validateLoggerEnvironment } from './environment.schema';
import { LOGGER_CONFIG, type LoggerConfig, validateLoggerConfig } from './logger.config';
import { LoggerService } from './logger.service';

// Interface for async options
export interface LoggerModuleAsyncOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  imports?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => Promise<LoggerConfig> | LoggerConfig;
}

@Global()
@Module({
  // Base providers that are always available
  exports: [CorrelationService, LoggerService],
  providers: [CorrelationService, LoggerService],
})
export class LoggerModule {
  /**
   * Provides a simple, convention-based logger.
   * Reads from environment variables and allows for partial overrides.
   */
  static forRoot(config?: Partial<LoggerConfig>): DynamicModule {
    return {
      module: LoggerModule,
      providers: [
        {
          provide: LOGGER_CONFIG,
          useFactory: (): LoggerConfig => {
            // 1. Get the validated base config from environment variables.
            const environment = validateLoggerEnvironment(process.env);

            // 2. Create the base config from environment
            const envConfig: LoggerConfig = {
              auditLogDirname: environment.LOGGER_AUDIT_LOG_DIRNAME,
              auditLogEnabled: environment.LOGGER_AUDIT_LOG_ENABLED,
              auditLogFilename: environment.LOGGER_AUDIT_LOG_FILENAME,
              auditLogRetentionDays: environment.LOGGER_AUDIT_LOG_RETENTION_DAYS,
              logLevel: environment.LOGGER_LOG_LEVEL as keyof typeof import('./environment.schema').logLevelsSchema,
              nodeEnv: environment.NODE_ENV,
              serviceName: environment.LOGGER_SERVICE_NAME,
            };

            // 3. Merge user's overrides.
            const finalConfig: LoggerConfig = {
              ...envConfig, // Spread the validated env config
              ...config, // Override with any user-provided values
            };

            // 4. Validate the FINAL merged object. This is the crucial step.
            return validateLoggerConfig(finalConfig);
          },
        },
      ],
    };
  }

  /**
   * Provides a fully flexible, async logger configuration.
   * The user is responsible for providing the full config object,
   * which will be validated upon creation.
   */
  static forRootAsync(options: LoggerModuleAsyncOptions): DynamicModule {
    return {
      imports: options.imports || [],
      module: LoggerModule,
      providers: [
        {
          inject: options.inject || [],
          provide: LOGGER_CONFIG,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useFactory: async (...args: any[]): Promise<LoggerConfig> => {
            // 1. Await the user's config factory.
            const userConfig = await options.useFactory(...args);

            // 2. Validate the result of the user's factory. This closes the gap.
            return validateLoggerConfig(userConfig);
          },
        },
      ],
    };
  }
}
