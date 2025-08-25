import { Database } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import type { Logger } from '@crypto/shared-logger';
import fs from 'fs';
import path from 'path';

// Configuration types
export interface BlockchainExplorersConfig {
  [blockchain: string]: {
    explorers: ExplorerConfig[];
  };
}

interface ExplorerConfig {
  enabled: boolean;
  mainnet: {
    baseUrl: string;
  };
  name: string;
  priority: number;
  rateLimit: {
    requestsPerSecond: number;
  };
  requiresApiKey?: boolean;
  retries: number;
  testnet: {
    baseUrl: string;
  };
  timeout: number;
}

export interface ExchangeConfiguration {
  exchanges: {
    [exchangeId: string]: {
      adapterType: 'ccxt' | 'native' | 'csv';
      credentials: Record<string, string>;
      enabled: boolean;
      options: Record<string, unknown>;
    };
  };
}

// Bootstrap options
export interface BootstrapOptions {
  clearDatabase?: boolean;
  exchangeConfigPath?: string;
  explorerConfigPath?: string;
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
   * Load exchange configuration
   */
  static async loadExchangeConfig(configPath?: string): Promise<ExchangeConfiguration> {
    const defaultPath = path.join(process.cwd(), 'config', 'exchanges.json');
    const finalPath = configPath || defaultPath;

    try {
      const configContent = await fs.promises.readFile(finalPath, 'utf8');
      return JSON.parse(configContent);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Create default configuration
        const defaultConfig: ExchangeConfiguration = {
          exchanges: {
            coinbase: {
              adapterType: 'ccxt',
              credentials: {
                apiKey: 'env:COINBASE_API_KEY',
                secret: 'env:COINBASE_SECRET',
              },
              enabled: false,
              options: {},
            },
            kraken: {
              adapterType: 'ccxt',
              credentials: {
                apiKey: 'env:KRAKEN_API_KEY',
                secret: 'env:KRAKEN_SECRET',
              },
              enabled: false,
              options: {},
            },
            kucoin: {
              adapterType: 'native',
              credentials: {
                apiKey: 'env:KUCOIN_API_KEY',
                password: 'env:KUCOIN_PASSPHRASE',
                secret: 'env:KUCOIN_SECRET',
              },
              enabled: false,
              options: {},
            },
          },
        };

        // Ensure config directory exists
        await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });

        // Write default config
        await fs.promises.writeFile(finalPath, JSON.stringify(defaultConfig, null, 2));

        const logger = getLogger('ConfigUtils');
        logger.info(`Created default exchange configuration at ${finalPath}`);
        return defaultConfig;
      }

      throw new Error(
        `Failed to load exchange configuration from ${finalPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Load blockchain explorer configuration
   */
  static loadExplorerConfig(configPath?: string): BlockchainExplorersConfig {
    const finalPath = configPath
      ? path.resolve(process.cwd(), configPath)
      : process.env.BLOCKCHAIN_EXPLORERS_CONFIG
        ? path.resolve(process.cwd(), process.env.BLOCKCHAIN_EXPLORERS_CONFIG)
        : path.join(process.cwd(), 'config/blockchain-explorers.json');

    try {
      const configData = fs.readFileSync(finalPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      throw new Error(
        `Failed to load blockchain explorer configuration from ${finalPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resolve environment variables in configuration
   */
  static resolveEnvironmentVariables(credentials: Record<string, unknown>): Record<string, unknown> {
    const resolved = { ...credentials };
    const logger = getLogger('ConfigUtils');

    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string' && value.startsWith('env:')) {
        const envVarName = value.substring(4); // Remove 'env:' prefix
        const envValue = process.env[envVarName];

        if (!envValue) {
          logger.warn(`Environment variable ${envVarName} not found for credential ${key}`);
          throw new Error(`Missing environment variable: ${envVarName}`);
        }

        resolved[key] = envValue;
        logger.debug(`Resolved ${key} from environment variable ${envVarName}`);
      }
    }

    return resolved;
  }
}

// Convenience exports for direct function access
export const loadExplorerConfig = ConfigUtils.loadExplorerConfig;
export const loadExchangeConfig = ConfigUtils.loadExchangeConfig;
export const initializeDatabase = ConfigUtils.initializeDatabase;
export const createLogger = ConfigUtils.createLogger;
export const resolveEnvironmentVariables = ConfigUtils.resolveEnvironmentVariables;
