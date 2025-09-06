import { z } from 'zod';

import { logLevelsSchema } from './environment.schema';

export interface LoggerConfig {
  auditLogDirname: string;
  auditLogEnabled: boolean;
  auditLogFilename: string;
  auditLogRetentionDays: number;
  logLevel: keyof typeof logLevelsSchema;
  nodeEnv: 'production' | 'development' | 'test';
  serviceName: string;
}

export const LOGGER_CONFIG = Symbol('LOGGER_CONFIG');

// Derive log level keys from the schema to maintain single source of truth
const logLevelKeys = Object.keys(logLevelsSchema) as (keyof typeof logLevelsSchema)[];

// The single source of truth for validating the final config object.
export const loggerConfigSchema = z.object({
  auditLogDirname: z.string().min(1),
  auditLogEnabled: z.boolean(),
  auditLogFilename: z.string().min(1),
  auditLogRetentionDays: z.number().int().min(0),
  logLevel: z.enum(logLevelKeys as [keyof typeof logLevelsSchema, ...(keyof typeof logLevelsSchema)[]]).default('info'),
  nodeEnv: z.enum(['production', 'development', 'test']),
  serviceName: z.string().min(1),
});

// A helper function to validate the config, used by the module.
export function validateLoggerConfig(config: LoggerConfig): LoggerConfig {
  return loggerConfigSchema.parse(config);
}
