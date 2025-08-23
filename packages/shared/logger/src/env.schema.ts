import { z } from "zod";

// Define log levels schema
export const logLevelsSchema = {
  audit: 5,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
} as const;

// Define environment schema
export const loggerEnvSchema = z.object({
  NODE_ENV: z.enum(["production", "development"]).default("development"),
  LOGGER_LOG_LEVEL: z
    .string()
    .refine((val: string) => Object.keys(logLevelsSchema).includes(val), {
      message: "Invalid log level",
    })
    .default("info"),
  LOGGER_AUDIT_LOG_ENABLED: z
    .string()
    .default("true")
    .transform((val: string) => val === "true"),
  LOGGER_AUDIT_LOG_DIRNAME: z
    .string()
    .trim()
    .min(1, { message: "Invalid audit log directory name" })
    .default("logs"),
  LOGGER_AUDIT_LOG_FILENAME: z
    .string()
    .trim()
    .min(1, { message: "Invalid audit log file name" })
    .default("audit"),
  LOGGER_AUDIT_LOG_RETENTION_DAYS: z
    .string()
    .default("30")
    .transform((val: string) => parseInt(val, 10)),
  LOGGER_SERVICE_NAME: z.string().default("frontend-service"),
});

// Infer TypeScript type from schema
export type LoggerEnvConfig = z.infer<typeof loggerEnvSchema>;

// Function to validate environment variables
export function validateLoggerEnv(
  env: NodeJS.ProcessEnv = process.env,
): LoggerEnvConfig {
  return loggerEnvSchema.parse(env);
}
