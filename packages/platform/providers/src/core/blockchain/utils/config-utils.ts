import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@exitbook/core';

// Configuration types
export type BlockchainExplorersConfig = Record<
  string,
  {
    defaultEnabled?: string[] | undefined;
    overrides?: Record<string, ProviderOverride> | undefined;
  }
>;

export interface ProviderOverride {
  description?: string | undefined;
  enabled?: boolean | undefined;
  priority?: number | undefined;
  rateLimit?: {
    burstLimit?: number | undefined;
    requestsPerHour?: number | undefined;
    requestsPerMinute?: number | undefined;
    requestsPerSecond?: number | undefined;
  };
  retries?: number | undefined;
  timeout?: number | undefined;
}

/**
 * Configuration utilities for dependency injection
 */
export class ConfigUtils {
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
      throw new Error(`Failed to load blockchain explorer configuration from ${finalPath}: ${getErrorMessage(error)}`);
    }
  }
}

// Convenience exports for direct function access
export const loadExplorerConfig = (configPath?: string) => ConfigUtils.loadExplorerConfig(configPath);
