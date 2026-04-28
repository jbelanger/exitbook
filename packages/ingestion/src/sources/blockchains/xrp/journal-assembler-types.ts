import type { XrpTransaction } from '@exitbook/blockchain-providers/xrp';
import type { AccountingJournalDraft, AccountingPostingDraft, SourceActivityDraft } from '@exitbook/ledger';

import type { BlockchainLedgerProcessorAccountContext } from '../../../shared/types/processors.js';

export interface XrpProcessorV2Context {
  account: BlockchainLedgerProcessorAccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
  walletAddresses?: readonly string[] | undefined;
}

export interface XrpProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: string[];
}

export interface XrpLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface XrpJournalAssemblyParts {
  feePosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export type XrpTransactionGroup = readonly XrpTransaction[];
