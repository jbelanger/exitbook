import fs from 'node:fs';
import path from 'node:path';

import type { Logger } from './pino-logger';
import { getLogger } from './pino-logger';
import type { LoadRawDataFilters } from './services/raw-data-repository';
import type { UniversalTransaction } from './types';

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
export class Database {
  async clearAndReinitialize(): Promise<void> {
    // Placeholder for actual database clearing and reinitialization logic
    return Promise.resolve();
  }
  async getImportSessionsWithRawData(_sourceId: string): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  async saveTransaction(_transaction: UniversalTransaction): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  async getRawTransactions(_data?: LoadRawDataFilters): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  async updateRawTransactionProcessingStatus(
    _sourceId: number,
    _sourceType: string,
    _rawData?: string,
    _options?: string,
  ): Promise<number> {
    return Promise.resolve(0);
  }
  async saveRawTransactions(
    _sourceId: string,
    _sourceType: string,
    _rawData: unknown,
    _options?: unknown,
  ): Promise<number> {
    return Promise.resolve(0);
  }
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
  static async initializeDatabase(this: void, clearDatabase = false): Promise<Database> {
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
  static loadExplorerConfig(this: void, configPath?: string): BlockchainExplorersConfig | null {
    const finalPath = configPath
      ? path.resolve(process.cwd(), configPath)
      : process.env['BLOCKCHAIN_EXPLORERS_CONFIG']
        ? path.resolve(process.cwd(), process.env['BLOCKCHAIN_EXPLORERS_CONFIG'])
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
        `Failed to load blockchain explorer configuration from ${finalPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// Convenience exports for direct function access
export const loadExplorerConfig = ConfigUtils.loadExplorerConfig;
export const initializeDatabase = ConfigUtils.initializeDatabase;
export const createLogger = (name: string) => ConfigUtils.createLogger(name);
