import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { AccountingLayerBuildResult } from '../accounting-layer/accounting-layer-types.js';

export interface AccountingLayerSource {
  transactions: Transaction[];
}

/**
 * Raw provenance input for canonical accounting-layer derivation.
 *
 * Data implementations stay limited to loading processed transactions.
 * Accounting owns the read-model materialization itself.
 */
export interface IAccountingLayerSourceReader {
  loadAccountingLayerSource(): Promise<Result<AccountingLayerSource, Error>>;
}

export interface IAccountingLayerReader {
  loadAccountingLayer(): Promise<Result<AccountingLayerBuildResult, Error>>;
}
