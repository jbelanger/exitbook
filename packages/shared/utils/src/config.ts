import fs from 'node:fs';
import path from 'node:path';

import { Database } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

// Configuration types
export type BlockchainExplorersConfig = Record<
  string,
  {
    defaultEnabled?: string[];
    overrides?: Record<string, ProviderOverride>;
  }
>;

export interface ProviderOverride {
  description?: string;
  enabled?: boolean;
  priority?: number;
  rateLimit?: {
    burstLimit?: number;
    requestsPerHour?: number;
    requestsPerMinute?: number;
    requestsPerSecond?: number;
  };
  retries?: number;
  timeout?: number;
}

/**
 * Configuration utilities for dependency injection
 */
export class ConfigUtils {
  /**
   * Create logger instance
   */
  static createLogger(name: string): Logger {
    return getLogger(name);
  }

  /**
   * Initialize database with optional cleanup
   */
  static async initializeDatabase(clearDatabase = false): Promise<Database> {
    const database = new Database();

    if (clearDatabase) {
      await database.clearAndReinitialize();
      const logger = getLogger('ConfigUtils');
      logger.info('Database cleared and reinitialized');
    }

    return database;
  }

  /**
   * Load blockchain explorer configuration
   * Returns undefined if configuration file doesn't exist (for optional config)
   */
  static loadExplorerConfig(configPath?: string): BlockchainExplorersConfig | undefined {
    const finalPath = configPath
      ? path.resolve(process.cwd(), configPath)
      : process.env.BLOCKCHAIN_EXPLORERS_CONFIG
        ? path.resolve(process.cwd(), process.env.BLOCKCHAIN_EXPLORERS_CONFIG)
        : path.join(process.cwd(), 'config/blockchain-explorers.json');

    try {
      const configData = fs.readFileSync(finalPath, 'utf-8');
      return JSON.parse(configData) as BlockchainExplorersConfig;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist - this is OK, we'll use registry defaults
        return undefined;
      }
      throw new Error(
        `Failed to load blockchain explorer configuration from ${finalPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Convenience exports for direct function access
export const loadExplorerConfig = (configPath?: string) => ConfigUtils.loadExplorerConfig(configPath);
export const initializeDatabase = (clearDatabase = false) => ConfigUtils.initializeDatabase(clearDatabase);
export const createLogger = (name: string) => ConfigUtils.createLogger(name);
