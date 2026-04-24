import type { EvmTransaction } from '@exitbook/blockchain-providers/evm';
import type { Currency } from '@exitbook/foundation';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingPostingDraft,
  SourceActivityDraft,
} from '@exitbook/ledger';

import type { EvmMovement } from './types.js';

export interface AccountBasedLedgerNativeAssetConfig {
  assetIdKind: 'native_asset' | 'symbol_asset';
  decimals: number;
  symbol: Currency;
}

export interface AccountBasedLedgerChainConfig {
  chainName: string;
  nativeAssets?: readonly AccountBasedLedgerNativeAssetConfig[] | undefined;
  nativeCurrency: Currency;
  nativeDecimals: number;
}

export interface EvmProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface EvmProcessorV2Context {
  account: EvmProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface EvmProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: string[];
}

export interface EvmLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface EvmAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export type EvmMovementDirection = 'in' | 'out';

export interface EvmMovementPostingInput {
  direction: EvmMovementDirection;
  movement: EvmMovement;
}

export interface EvmJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export type EvmTransactionGroup = readonly EvmTransaction[];
