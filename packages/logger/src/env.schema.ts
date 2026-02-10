import { z } from 'zod';

// Define log levels schema
export const logLevelsSchema = {
  debug: 20,
  error: 50,
  info: 30,
  trace: 10,
  warn: 40,
} as const;

// Define environment schema
export const loggerEnvSchema = z.object({
  LOGGER_CONSOLE_ENABLED: z
    .string()
    .default('false')
    .transform((val: string) => val === 'true'),
  LOGGER_FILE_LOG_ENABLED: z
    .string()
    .default('false')
    .transform((val: string) => val === 'true'),
  LOGGER_FILE_LOG_FILENAME: z.string().trim().min(1, { message: 'Invalid file log name' }).default('application.log'),
  LOGGER_LOG_DIRNAME: z.string().trim().min(1, { message: 'Invalid log directory name' }).default('logs'),
  LOGGER_LOG_LEVEL: z
    .string()
    .refine((val: string) => Object.keys(logLevelsSchema).includes(val), {
      message: 'Invalid log level',
    })
    .default('info'),
  LOGGER_SERVICE_NAME: z.string().default('exitbook'),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
});

// Infer TypeScript type from schema
export type LoggerEnvConfig = z.infer<typeof loggerEnvSchema>;

// Function to validate environment variables
export function validateLoggerEnv(env: NodeJS.ProcessEnv = process.env): LoggerEnvConfig {
  return loggerEnvSchema.parse(env);
}
