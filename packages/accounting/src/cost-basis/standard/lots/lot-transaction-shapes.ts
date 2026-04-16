import type { AssetMovement, FeeMovementDraft, PriceAtTxTime, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type {
  AccountingAssetEntryView,
  AccountingTransactionView,
} from '../../../accounting-layer/accounting-layer-types.js';
import type { AccountingScopedTransaction } from '../../../accounting-layer/accounting-scoped-types.js';

export type CostBasisTransactionLike = AccountingScopedTransaction | AccountingTransactionView | Transaction;
export type CostBasisMovementLike = AssetMovement | AccountingAssetEntryView;

function isAccountingAssetEntryView(movement: CostBasisMovementLike): movement is AccountingAssetEntryView {
  return 'entryFingerprint' in movement;
}

export function getRawTransaction(transaction: CostBasisTransactionLike): Transaction {
  if ('processedTransaction' in transaction) {
    return transaction.processedTransaction;
  }

  return 'tx' in transaction ? transaction.tx : transaction;
}

export function getTransactionMovements(transaction: CostBasisTransactionLike): {
  inflows: readonly CostBasisMovementLike[];
  outflows: readonly CostBasisMovementLike[];
} {
  if ('processedTransaction' in transaction) {
    return {
      inflows: transaction.inflows,
      outflows: transaction.outflows,
    };
  }

  return {
    inflows: transaction.movements.inflows ?? [],
    outflows: transaction.movements.outflows ?? [],
  };
}

export function getTransactionFees(
  transaction: CostBasisTransactionLike
): Pick<FeeMovementDraft, 'amount' | 'assetId' | 'assetSymbol' | 'priceAtTxTime' | 'scope' | 'settlement'>[] {
  if ('processedTransaction' in transaction) {
    return transaction.fees.map((fee) => ({
      amount: fee.quantity,
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol,
      priceAtTxTime: fee.priceAtTxTime,
      scope: fee.feeScope,
      settlement: fee.feeSettlement,
    }));
  }

  return transaction.fees;
}

export function getMovementAssetId(movement: CostBasisMovementLike): string {
  return movement.assetId;
}

export function getMovementAssetSymbol(movement: CostBasisMovementLike): Currency {
  return movement.assetSymbol;
}

export function getMovementFingerprint(movement: CostBasisMovementLike): string {
  return movement.movementFingerprint;
}

export function getMovementGrossQuantity(movement: CostBasisMovementLike): Decimal {
  return 'grossAmount' in movement ? movement.grossAmount : movement.grossQuantity;
}

export function getMovementNetQuantity(movement: CostBasisMovementLike): Decimal | undefined {
  return isAccountingAssetEntryView(movement) ? movement.netQuantity : movement.netAmount;
}

export function getMovementPriceAtTxTime(movement: CostBasisMovementLike): PriceAtTxTime | undefined {
  return movement.priceAtTxTime;
}

export function getMovementRole(movement: CostBasisMovementLike): AssetMovement['movementRole'] {
  return isAccountingAssetEntryView(movement) ? movement.role : movement.movementRole;
}
