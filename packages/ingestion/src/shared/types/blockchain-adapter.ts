import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { KyselyDB } from '@exitbook/data';
import { type Result } from 'neverthrow';

import type { IScamDetectionService } from '../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../features/token-metadata/token-metadata-service.interface.js';

import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface ProcessorDeps {
  providerManager: BlockchainProviderManager;
  tokenMetadataService: ITokenMetadataService;
  scamDetectionService: IScamDetectionService | undefined;
  db: KyselyDB;
  accountId: number;
}

interface BlockchainAdapterBase {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (deps: ProcessorDeps) => ITransactionProcessor;
}

export interface AccountBasedBlockchainAdapter extends BlockchainAdapterBase {
  chainModel: 'account-based';
}

export interface UtxoBlockchainAdapter extends BlockchainAdapterBase {
  chainModel: 'utxo';
  isExtendedPublicKey: (address: string) => boolean;
  deriveAddressesFromXpub: (
    xpub: string,
    providerManager: BlockchainProviderManager,
    blockchain: string,
    gap?: number
  ) => Promise<Result<DerivedAddress[], Error>>;
}

export type BlockchainAdapter = AccountBasedBlockchainAdapter | UtxoBlockchainAdapter;

export function isUtxoAdapter(adapter: BlockchainAdapter): adapter is UtxoBlockchainAdapter {
  return adapter.chainModel === 'utxo';
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

/**
 * Clear all registered blockchain adapters.
 * Used for testing to avoid state leaking between test suites.
 */
export function clearBlockchainAdapters(): void {
  adapters.clear();
}
