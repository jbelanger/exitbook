import type { AssetMovement, FeeMovement, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export interface ScopedFeeMovement extends FeeMovement {
  originalTransactionId: number;
}

export interface AccountingScopedTransaction {
  tx: Transaction;
  /**
   * Raw transaction ids that must accompany this scoped transaction when
   * rebuilding after price filtering, because same-hash scoping consumed
   * sibling rows to produce the current scoped shape.
   */
  rebuildDependencyTransactionIds: number[];
  movements: {
    inflows: AssetMovement[];
    outflows: AssetMovement[];
  };
  fees: ScopedFeeMovement[];
}

export interface InternalTransferCarryoverDraftTarget {
  targetTransactionId: number;
  targetMovementFingerprint: string;
  quantity: Decimal;
}

export interface InternalTransferCarryoverDraft {
  assetId: string;
  assetSymbol: Currency;
  fee: ScopedFeeMovement;
  retainedQuantity: Decimal;
  sourceTransactionId: number;
  sourceMovementFingerprint: string;
  targets: InternalTransferCarryoverDraftTarget[];
}

export interface AccountingScopedBuildResult {
  inputTransactions: Transaction[];
  transactions: AccountingScopedTransaction[];
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[];
}
