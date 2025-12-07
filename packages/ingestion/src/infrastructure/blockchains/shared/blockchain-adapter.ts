import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { type Result } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import type { IImporter } from '../../../types/importers.js';
import type { ITransactionProcessor } from '../../../types/processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface BlockchainAdapter {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (tokenMetadataService?: ITokenMetadataService) => Result<ITransactionProcessor, Error>;

  /**
   * Indicates whether this blockchain uses the UTXO model (Bitcoin, Cardano).
   * UTXO chains store one transaction record per (address, tx_hash) without deduplication.
   * Account-based chains (Solana, NEAR, Substrate) require deduplication and use derivedAddresses.
   */
  isUTXOChain?: boolean;

  /**
   * Check if an address is an extended public key (xpub/ypub/zpub for Bitcoin, xpub for Cardano)
   * Optional - only implemented for blockchains that support xpub
   */
  isExtendedPublicKey?: (address: string) => boolean;

  /**
   * Derive child addresses from an extended public key
   * Optional - only implemented for blockchains that support xpub
   */
  deriveAddressesFromXpub?: (
    xpub: string,
    providerManager: BlockchainProviderManager,
    blockchain: string,
    gap?: number
  ) => Promise<DerivedAddress[]>;
}

const adapters = new Map<string, BlockchainAdapter>();

export function registerBlockchain(config: BlockchainAdapter): void {
  adapters.set(config.blockchain, config);
}

export function getBlockchainAdapter(blockchain: string): BlockchainAdapter | undefined {
  return adapters.get(blockchain);
}

export function getAllBlockchains(): string[] {
  return Array.from(adapters.keys()).sort();
}

export function hasBlockchainAdapter(blockchain: string): boolean {
  return adapters.has(blockchain);
}
