/**
 * Database configuration utilities
 * Manages feature toggles for database layer migration
 */

/**
 * Feature toggle for using Kysely instead of raw SQLite3
 * Can be controlled via environment variable or direct configuration
 */
export function useKyselyDatabase(): boolean {
  const envValue = process.env.USE_KYSELY_DB;

  if (envValue !== undefined) {
    return envValue.toLowerCase() === 'true' || envValue === '1';
  }

  // Default to false during migration period
  return false;
}

/**
 * Configuration object for database feature toggles
 */
export interface DatabaseConfig {
  dbPath?: string;
  useKysely: boolean;
}

/**
 * Get database configuration based on environment and defaults
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    dbPath: process.env.DATABASE_PATH,
    useKysely: useKyselyDatabase(),
  };
}
