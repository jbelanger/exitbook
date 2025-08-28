import { Database } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import fs from 'fs';
import path from 'path';

// Configuration types
export interface BlockchainExplorersConfig {
  [blockchain: string]: {
    defaultEnabled?: string[];
    overrides?: {
      [providerName: string]: ProviderOverride;
    };
  };
}

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
   * Returns null if configuration file doesn't exist (for optional config)
   */
  static loadExplorerConfig(configPath?: string): BlockchainExplorersConfig | null {
    const finalPath = configPath
      ? path.resolve(process.cwd(), configPath)
      : process.env.BLOCKCHAIN_EXPLORERS_CONFIG
        ? path.resolve(process.cwd(), process.env.BLOCKCHAIN_EXPLORERS_CONFIG)
        : path.join(process.cwd(), 'config/blockchain-explorers.json');

    try {
      const configData = fs.readFileSync(finalPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist - this is OK, we'll use registry defaults
        return null;
      }
      throw new Error(
        `Failed to load blockchain explorer configuration from ${finalPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Convenience exports for direct function access
export const loadExplorerConfig = ConfigUtils.loadExplorerConfig;
export const initializeDatabase = ConfigUtils.initializeDatabase;
export const createLogger = ConfigUtils.createLogger;
