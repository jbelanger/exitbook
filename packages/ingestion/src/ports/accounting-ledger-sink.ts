import type { Result } from '@exitbook/foundation';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';

export interface AccountingLedgerWrite {
  journals: readonly AccountingJournalDraft[];
  rawTransactionIds: readonly number[];
  sourceActivity: SourceActivityDraft;
}

export interface AccountingLedgerSinkSummary {
  diagnostics: number;
  journals: number;
  postings: number;
  rawAssignments: number;
  sourceActivities: number;
  sourceComponents: number;
}

/**
 * Port for shadow-persisting the accounting ledger model in parallel with the
 * legacy processed transaction projection.
 */
export interface IAccountingLedgerSink {
  replaceSourceActivities(
    writes: readonly AccountingLedgerWrite[]
  ): Promise<Result<AccountingLedgerSinkSummary, Error>>;
}
