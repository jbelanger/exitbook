import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { DataContext } from '@exitbook/data';
import { type Result } from 'neverthrow';

import type { IScamDetectionService } from '../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../features/token-metadata/token-metadata-service.interface.js';

import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface BlockchainProcessorContext {
  providerManager: BlockchainProviderManager;
  tokenMetadataService: ITokenMetadataService;
  scamDetectionService: IScamDetectionService | undefined;
  db: DataContext;
  accountId: number;
}

interface BlockchainAdapterBase {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (deps: BlockchainProcessorContext) => ITransactionProcessor;
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
