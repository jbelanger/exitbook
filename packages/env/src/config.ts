import path from 'node:path';

import { z } from 'zod';

const envSchema = z.object({
  EXITBOOK_DATA_DIR: z.string().min(1).or(z.undefined()),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

type ValidatedEnv = z.infer<typeof envSchema>;

let validatedEnv: ValidatedEnv | undefined;

/**
 * Validates environment variables on first access.
 * Caches the result for subsequent calls.
 * @throws Error if validation fails
 */
function validateEnv(): ValidatedEnv {
  if (!validatedEnv) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.issues.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Environment validation failed:\n${errors}`);
    }
    validatedEnv = result.data;
  }
  return validatedEnv;
}

/**
 * Get the data directory path for databases and other persistent files.
 *
 * Priority:
 * 1. EXITBOOK_DATA_DIR environment variable (if set)
 * 2. process.cwd() + '/data' (default)
 *
 * For E2E tests, set EXITBOOK_DATA_DIR to ensure consistent database location.
 * For unit tests, prefer using temporary directories instead.
 *
 * @returns Absolute path to the data directory
 */
export function getDataDirectory(): string {
  const env = validateEnv();
  return env.EXITBOOK_DATA_DIR ?? path.join(process.cwd(), 'data');
}

/**
 * Get the current NODE_ENV value.
 * @returns 'development', 'production', or 'test'
 */
export function getNodeEnv(): ValidatedEnv['NODE_ENV'] {
  const env = validateEnv();
  return env.NODE_ENV;
}

/**
 * Check if running in test environment.
 */
export function isTest(): boolean {
  return getNodeEnv() === 'test';
}

/**
 * Check if running in production environment.
 */
export function isProduction(): boolean {
  return getNodeEnv() === 'production';
}

/**
 * Check if running in development environment.
 */
export function isDevelopment(): boolean {
  return getNodeEnv() === 'development';
}
