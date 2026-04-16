import type { FeeMovement, MovementRole, PriceAtTxTime, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { AccountingEntry } from './accounting-entry-types.js';

export interface AccountingDerivationDependency {
  ownerTxFingerprint: string;
  supportingTxFingerprint: string;
  reason: 'same_hash_internal_scoping';
}

export interface InternalTransferCarryoverTargetBinding {
  quantity: Decimal;
  targetEntryFingerprint: string;
}

export interface InternalTransferCarryover {
  sourceEntryFingerprint: string;
  targetBindings: readonly InternalTransferCarryoverTargetBinding[];
  feeEntryFingerprint?: string | undefined;
}

interface AccountingEntryViewBase {
  assetId: string;
  assetSymbol: Currency;
  entryFingerprint: string;
  movementFingerprint: string;
  priceAtTxTime?: PriceAtTxTime | undefined;
}

export interface AccountingAssetEntryView extends AccountingEntryViewBase {
  grossQuantity: Decimal;
  netQuantity?: Decimal | undefined;
  role: MovementRole;
}

export interface AccountingFeeEntryView extends AccountingEntryViewBase {
  feeScope: FeeMovement['scope'];
  feeSettlement: FeeMovement['settlement'];
  quantity: Decimal;
}

export interface AccountingTransactionView {
  fees: readonly AccountingFeeEntryView[];
  inflows: readonly AccountingAssetEntryView[];
  outflows: readonly AccountingAssetEntryView[];
  processedTransaction: Transaction;
}

export interface AccountingModelBuildResult {
  accountingTransactionViews: readonly AccountingTransactionView[];
  derivationDependencies: readonly AccountingDerivationDependency[];
  entries: readonly AccountingEntry[];
  internalTransferCarryovers: readonly InternalTransferCarryover[];
  processedTransactions: readonly Transaction[];
}
