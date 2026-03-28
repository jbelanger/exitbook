import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Result } from '@exitbook/foundation';

import type { IScamDetectionService } from '../../features/scam-detection/contracts.js';

import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

export interface CommonBlockchainProcessorContext {
  providerRuntime: IBlockchainProviderRuntime;
  scamDetectionService: IScamDetectionService | undefined;
}

interface BlockchainAdapterBase {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) => IImporter;
  createProcessor: (deps: CommonBlockchainProcessorContext) => ITransactionProcessor;
}

export interface AccountBasedBlockchainAdapter extends BlockchainAdapterBase {
  chainModel: 'account-based';
}

export interface UtxoBlockchainAdapter extends BlockchainAdapterBase {
  chainModel: 'utxo';
  isExtendedPublicKey: (address: string) => boolean;
  deriveAddressesFromXpub: (
    xpub: string,
    providerRuntime: IBlockchainProviderRuntime,
    blockchain: string,
    gap?: number
  ) => Promise<Result<DerivedAddress[], Error>>;
}

export type BlockchainAdapter = AccountBasedBlockchainAdapter | UtxoBlockchainAdapter;

export function isUtxoAdapter(adapter: BlockchainAdapter): adapter is UtxoBlockchainAdapter {
  return adapter.chainModel === 'utxo';
}
