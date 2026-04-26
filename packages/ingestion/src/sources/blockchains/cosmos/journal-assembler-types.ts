import type { CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import type { Currency } from '@exitbook/foundation';
import type { AccountingJournalDraft, AccountingPostingDraft, SourceActivityDraft } from '@exitbook/ledger';

export interface CosmosProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface CosmosProcessorV2Context {
  account: CosmosProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface CosmosProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: string[];
}

export interface CosmosLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface CosmosAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export interface CosmosPostingBuildParts {
  feePosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export type CosmosTransactionGroup = readonly CosmosTransaction[];
