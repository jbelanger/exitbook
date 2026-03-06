import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Result } from '@exitbook/core';

export interface ProviderConfig {
  apiKeys: Record<string, string>;
  cachePath?: string | undefined;
}

/**
 * Lifecycle management for blockchain and price provider managers.
 *
 * App-owned, host-provided config (API keys, cache paths).
 */
export class ProviderRegistry {
  private blockchainManager: BlockchainProviderManager | undefined;

  constructor(private readonly config: ProviderConfig) {}

  async getBlockchainManager(): Promise<Result<BlockchainProviderManager, Error>> {
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    throw new Error('Not implemented');
  }
}
