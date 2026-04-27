import type { Currency } from '@exitbook/foundation';
import type {
  AccountingJournalDraft,
  AccountingPostingDraft,
  AccountingPostingRole,
  AccountingSourceComponentKind,
  SourceActivityDraft,
} from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

import type { NearCorrelatedTransaction } from './types.js';

export interface NearProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface NearProcessorV2Context {
  account: NearProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface NearProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface NearLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface NearAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export type NearLedgerMovementDirection = 'in' | 'out';

export interface NearLedgerSourceComponentInput {
  componentId: string;
  componentKind: AccountingSourceComponentKind;
  quantity: Decimal;
}

export interface NearLedgerMovement {
  asset: Currency;
  amount: Decimal;
  components: NearLedgerSourceComponentInput[];
  contractAddress?: string | undefined;
  direction: NearLedgerMovementDirection;
  feeSource?: 'balance-change' | 'receipt' | undefined;
  role: AccountingPostingRole;
}

export interface NearJournalAssemblyParts {
  feePostings: readonly AccountingPostingDraft[];
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export type NearProcessorV2CorrelatedTransaction = NearCorrelatedTransaction;
