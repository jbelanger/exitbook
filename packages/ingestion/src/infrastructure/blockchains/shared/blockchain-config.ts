import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { type Result } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import type { IImporter } from '../../../types/importers.js';
import type { ITransactionProcessor } from '../../../types/processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface BlockchainConfig {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (tokenMetadataService?: ITokenMetadataService) => Result<ITransactionProcessor, Error>;

  /**
   * Check if an address is an extended public key (xpub/ypub/zpub for Bitcoin, xpub for Cardano)
   * Optional - only implemented for blockchains that support xpub
   */
  isExtendedPublicKey?: (address: string) => boolean;

  /**
   * Derive child addresses from an extended public key
   * Optional - only implemented for blockchains that support xpub
   */
  deriveAddressesFromXpub?: (xpub: string, gap?: number) => Promise<DerivedAddress[]>;
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
