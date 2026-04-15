import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { AccountingEntry } from '../accounting-layer/accounting-entry-types.js';

export interface AccountingEntrySource {
  transactions: Transaction[];
}

/**
 * Raw provenance input for accounting-entry derivation.
 *
 * Data implementations stay limited to loading processed transactions.
 * Accounting owns the entry materialization itself.
 */
export interface IAccountingEntrySourceReader {
  loadAccountingEntrySource(): Promise<Result<AccountingEntrySource, Error>>;
}

export interface IAccountingEntryReader {
  loadAccountingEntries(): Promise<Result<AccountingEntry[], Error>>;
}
