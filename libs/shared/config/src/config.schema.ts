import { err, ok, Result } from 'neverthrow';
import { z } from 'zod';

export class ConfigValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    // Add newlines for much better readability in console output
    const message = issues.map(index => `  - ${index.path.join('.')}: ${index.message}`).join('\n');
    super(`Configuration validation failed with the following issues:\n${message}`);
    this.name = 'ConfigValidationError';
  }
}

const databaseSchema = z.object({
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DATABASE_SSL_MODE: z.string().default('prefer'),
  DATABASE_URL: z.string().url(),
});

const appSchema = z.object({
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  PROVIDERS_CONFIG_PATH: z.string().default('./config/providers.config.json'),
});

const blockchainConfigSchema = z.object({
  enabled: z.boolean(),
  priority: z.array(z.string()),
  providers: z.array(z.string()),
});

const providersDataSchema = z.record(z.string(), blockchainConfigSchema);

const finalConfigSchema = databaseSchema.merge(appSchema).extend({
  providers: providersDataSchema.optional(),
});

export type Configuration = z.infer<typeof finalConfigSchema>;

export function validateConfig(config: Record<string, unknown>): Result<Configuration, ConfigValidationError> {
  const validationResult = finalConfigSchema.safeParse(config);
  if (!validationResult.success) {
    return err(new ConfigValidationError(validationResult.error.issues));
  }
  return ok(validationResult.data);
}
