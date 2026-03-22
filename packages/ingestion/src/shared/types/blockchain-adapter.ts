import { type IBlockchainProviderManager } from '@exitbook/blockchain-providers';
import { type Result } from '@exitbook/core';

import type { IScamDetectionService } from '../../features/scam-detection/scam-detection-service.interface.js';
import type { INearBatchSource } from '../../ports/near-batch-source.js';

import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

interface BlockchainProcessorContext {
  providerManager: IBlockchainProviderManager;
  scamDetectionService: IScamDetectionService | undefined;
  /** Only needed by NEAR processors for balance-change delta derivation. */
  nearBatchSource?: INearBatchSource | undefined;
  accountId: number;
}

interface BlockchainAdapterBase {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: IBlockchainProviderManager, providerName?: string) => IImporter;
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
    providerManager: IBlockchainProviderManager,
    blockchain: string,
    gap?: number
  ) => Promise<Result<DerivedAddress[], Error>>;
}

export type BlockchainAdapter = AccountBasedBlockchainAdapter | UtxoBlockchainAdapter;

export function isUtxoAdapter(adapter: BlockchainAdapter): adapter is UtxoBlockchainAdapter {
  return adapter.chainModel === 'utxo';
}
