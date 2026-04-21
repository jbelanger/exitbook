import fs from 'node:fs';

import { getErrorMessage } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import { BlockchainExplorersConfigSchema, type BlockchainExplorersConfig } from './explorer-config.js';

export type { BlockchainExplorersConfig } from './explorer-config.js';

/**
 * Load blockchain explorer configuration from an explicit file path.
 * Returns undefined if no path is provided or the file doesn't exist.
 */
export function loadExplorerConfigOrThrow(configPath?: string): BlockchainExplorersConfig | undefined {
  if (!configPath) {
    return undefined;
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(configData) as unknown;
    return BlockchainExplorersConfigSchema.parse(parsed);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // File doesn't exist - this is OK, we'll use registry defaults
      return undefined;
    }
    throw new Error(`Failed to load blockchain explorer configuration from ${configPath}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export function loadBlockchainExplorerConfig(
  configPath?: string
): Result<BlockchainExplorersConfig | undefined, Error> {
  try {
    return ok(loadExplorerConfigOrThrow(configPath));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
