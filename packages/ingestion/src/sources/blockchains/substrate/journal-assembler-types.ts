import type { SubstrateTransaction } from '@exitbook/blockchain-providers/substrate';
import type { Currency } from '@exitbook/foundation';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingPostingDraft,
  SourceActivityDraft,
} from '@exitbook/ledger';

export interface SubstrateProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface SubstrateProcessorV2Context {
  account: SubstrateProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface SubstrateProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: string[];
}

export interface SubstrateLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface SubstrateAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export interface SubstrateJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  isProtocolEvent: boolean;
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export type SubstrateTransactionGroup = readonly SubstrateTransaction[];
