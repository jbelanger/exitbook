import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { AccountingModelBuildResult } from '../accounting-model/accounting-model-types.js';

export interface AccountingModelSource {
  transactions: Transaction[];
}

/**
 * Raw provenance input for canonical accounting model derivation.
 *
 * Data implementations stay limited to loading processed transactions.
 * Accounting owns the read-model materialization itself.
 */
export interface IAccountingModelSourceReader {
  loadAccountingModelSource(): Promise<Result<AccountingModelSource, Error>>;
}

export interface IAccountingModelReader {
  loadAccountingModel(): Promise<Result<AccountingModelBuildResult, Error>>;
}
