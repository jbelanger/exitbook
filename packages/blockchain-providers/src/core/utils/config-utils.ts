import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@exitbook/core';
import { z } from 'zod';

// Configuration schemas
const ProviderOverrideSchema = z.object({
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
  rateLimit: z
    .object({
      requestsPerSecond: z.number().optional(),
      requestsPerMinute: z.number().optional(),
      requestsPerHour: z.number().optional(),
      burstLimit: z.number().optional(),
    })
    .optional(),
  retries: z.number().optional(),
  timeout: z.number().optional(),
});

const BlockchainConfigSchema = z.object({
  defaultEnabled: z.array(z.string()).optional(),
  overrides: z.record(z.string(), ProviderOverrideSchema).optional(),
});

export const BlockchainExplorersConfigSchema = z.record(z.string(), BlockchainConfigSchema);

// Configuration types
export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type BlockchainExplorersConfig = z.infer<typeof BlockchainExplorersConfigSchema>;

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
