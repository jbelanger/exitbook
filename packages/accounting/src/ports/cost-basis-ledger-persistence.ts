import type { Account, PlatformKind, PriceAtTxTime, TransactionStatus } from '@exitbook/core';
import type { Currency, Result } from '@exitbook/foundation';
import type {
  AccountingBalanceCategory,
  AccountingJournalKind,
  AccountingJournalRelationshipKind,
  AccountingPostingRole,
  AccountingRelationshipAllocationSide,
  AccountingSettlement,
  AccountingSourceComponentKind,
  SourceActivityOrigin,
} from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

export type CostBasisLedgerRelationshipOrigin = 'processor' | 'ledger_linking';

export interface CostBasisLedgerSourceActivity {
  id: number;
  ownerAccountId: number;
  sourceActivityOrigin: SourceActivityOrigin;
  sourceActivityStableKey: string;
  sourceActivityFingerprint: string;
  platformKey: string;
  platformKind: PlatformKind;
  activityStatus: TransactionStatus;
  activityDatetime: Date;
  activityTimestampMs?: number | undefined;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
  blockchainName?: string | undefined;
  blockchainBlockHeight?: number | undefined;
  blockchainTransactionHash?: string | undefined;
  blockchainIsConfirmed?: boolean | undefined;
}

export interface CostBasisLedgerJournalDiagnostic {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error' | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CostBasisLedgerJournal {
  id: number;
  sourceActivityId: number;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  journalStableKey: string;
  journalKind: AccountingJournalKind;
  diagnostics: readonly CostBasisLedgerJournalDiagnostic[];
}

export interface CostBasisLedgerPostingSourceComponent {
  sourceComponentFingerprint: string;
  sourceActivityFingerprint: string;
  componentKind: AccountingSourceComponentKind;
  componentId: string;
  occurrence?: number | undefined;
  assetId?: string | undefined;
  quantity: Decimal;
}

export interface CostBasisLedgerPosting {
  id: number;
  journalId: number;
  journalFingerprint: string;
  postingFingerprint: string;
  postingStableKey: string;
  assetId: string;
  assetSymbol: Currency;
  quantity: Decimal;
  role: AccountingPostingRole;
  balanceCategory: AccountingBalanceCategory;
  settlement?: AccountingSettlement | undefined;
  priceAtTxTime?: PriceAtTxTime | undefined;
  sourceComponents: readonly CostBasisLedgerPostingSourceComponent[];
}

export interface CostBasisLedgerRelationshipAllocation {
  id: number;
  allocationSide: AccountingRelationshipAllocationSide;
  quantity: Decimal;
  sourceActivityFingerprint: string;
  journalFingerprint: string;
  postingFingerprint: string;
  assetId: string;
  assetSymbol: Currency;
  currentJournalId?: number | undefined;
  currentPostingId?: number | undefined;
}

export interface CostBasisLedgerRelationship {
  id: number;
  relationshipOrigin: CostBasisLedgerRelationshipOrigin;
  relationshipStableKey: string;
  relationshipKind: AccountingJournalRelationshipKind;
  recognitionStrategy: string;
  recognitionEvidence: Record<string, unknown>;
  confidenceScore?: Decimal | undefined;
  allocations: readonly CostBasisLedgerRelationshipAllocation[];
}

export interface CostBasisLedgerFacts {
  sourceActivities: readonly CostBasisLedgerSourceActivity[];
  journals: readonly CostBasisLedgerJournal[];
  postings: readonly CostBasisLedgerPosting[];
  relationships: readonly CostBasisLedgerRelationship[];
}

export interface CostBasisLedgerContext extends CostBasisLedgerFacts {
  accounts: readonly Account[];
}

export interface ICostBasisLedgerContextReader {
  loadCostBasisLedgerContext(): Promise<Result<CostBasisLedgerContext, Error>>;
}
