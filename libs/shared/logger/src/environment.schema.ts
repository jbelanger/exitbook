import { z } from 'zod';

// Define log levels schema
export const logLevelsSchema = {
  audit: 5,
  debug: 20,
  error: 50,
  info: 30,
  trace: 10,
  warn: 40,
} as const;

// Define environment schema
export const loggerEnvironmentSchema = z.object({
  LOGGER_AUDIT_LOG_DIRNAME: z.string().trim().min(1, { message: 'Invalid audit log directory name' }).default('logs'),
  LOGGER_AUDIT_LOG_ENABLED: z
    .string()
    .default('true')
    .transform((value: string) => value === 'true'),
  LOGGER_AUDIT_LOG_FILENAME: z.string().trim().min(1, { message: 'Invalid audit log file name' }).default('audit'),
  LOGGER_AUDIT_LOG_RETENTION_DAYS: z
    .string()
    .default('30')
    .transform((value: string) => parseInt(value, 10)),
  LOGGER_LOG_LEVEL: z
    .string()
    .refine((value: string) => Object.keys(logLevelsSchema).includes(value), {
      message: 'Invalid log level',
    })
    .default('info'),
  LOGGER_SERVICE_NAME: z.string().default('frontend-service'),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
});

// Infer TypeScript type from schema
export type LoggerEnvironmentConfig = z.infer<typeof loggerEnvironmentSchema>;

// Function to validate environment variables
export function validateLoggerEnvironment(environment: NodeJS.ProcessEnv = process.env): LoggerEnvironmentConfig {
  return loggerEnvironmentSchema.parse(environment);
}
