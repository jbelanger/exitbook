import type { BlockchainProviderManager } from '@exitbook/providers';
import { type Result } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import type { IImporter } from '../../../types/importers.js';
import type { ITransactionProcessor } from '../../../types/processors.js';

export interface BlockchainConfig {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (tokenMetadataService?: ITokenMetadataService) => Result<ITransactionProcessor, Error>;
}

const configs = new Map<string, BlockchainConfig>();

export function registerBlockchain(config: BlockchainConfig): void {
  configs.set(config.blockchain, config);
}

export function getBlockchainConfig(blockchain: string): BlockchainConfig | undefined {
  return configs.get(blockchain);
}

export function getAllBlockchains(): string[] {
  return Array.from(configs.keys()).sort();
}

export function hasBlockchainConfig(blockchain: string): boolean {
  return configs.has(blockchain);
}
