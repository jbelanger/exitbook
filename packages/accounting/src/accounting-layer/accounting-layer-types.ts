import type { Transaction } from '@exitbook/core';
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

export interface AccountingLayerBuildResult {
  processedTransactions: readonly Transaction[];
  entries: readonly AccountingEntry[];
  derivationDependencies: readonly AccountingDerivationDependency[];
  internalTransferCarryovers: readonly InternalTransferCarryover[];
}
