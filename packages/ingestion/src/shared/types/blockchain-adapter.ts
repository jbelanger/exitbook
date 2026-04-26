import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Result } from '@exitbook/foundation';

import type { ScamDetector } from '../../features/scam-detection/contracts.js';

import type { IImporter } from './importers.js';
import type { IAccountingLedgerProcessor, ITransactionProcessor } from './processors.js';

export interface DerivedAddress {
  address: string;
  derivationPath: string;
}

/**
 * Legacy transaction processors still emit TransactionDraft diagnostics during
 * migration. New ledger processors must not depend on this screening hook.
 */
export interface LegacyBlockchainProcessorContext {
  providerRuntime: IBlockchainProviderRuntime;
  scamDetector: ScamDetector | undefined;
}

/**
 * Ledger-v2 processors materialize accounting facts only. Asset screening and
 * review policy run as separate ingestion projections.
 */
export interface BlockchainLedgerProcessorFactoryContext {
  providerRuntime: IBlockchainProviderRuntime;
}

interface BlockchainAdapterBase {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) => IImporter;
  createProcessor: (deps: LegacyBlockchainProcessorContext) => ITransactionProcessor;
  createLedgerProcessor?: ((deps: BlockchainLedgerProcessorFactoryContext) => IAccountingLedgerProcessor) | undefined;
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
