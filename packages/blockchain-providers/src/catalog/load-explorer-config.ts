import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@exitbook/foundation';

import { BlockchainExplorersConfigSchema, type BlockchainExplorersConfig } from './explorer-config.js';

export type { BlockchainExplorersConfig } from './explorer-config.js';

/**
 * Load blockchain explorer configuration.
 * Returns undefined if the configuration file doesn't exist (optional config).
 */
export function loadExplorerConfig(configPath?: string): BlockchainExplorersConfig | undefined {
  const finalPath = configPath
    ? path.resolve(process.cwd(), configPath)
    : process.env['BLOCKCHAIN_EXPLORERS_CONFIG']
      ? path.resolve(process.cwd(), process.env['BLOCKCHAIN_EXPLORERS_CONFIG'])
      : path.join(process.cwd(), 'config/blockchain-explorers.json');

  try {
    const configData = fs.readFileSync(finalPath, 'utf-8');
    const parsed = JSON.parse(configData) as unknown;
    return BlockchainExplorersConfigSchema.parse(parsed);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // File doesn't exist - this is OK, we'll use registry defaults
      return undefined;
    }
    throw new Error(`Failed to load blockchain explorer configuration from ${finalPath}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}
