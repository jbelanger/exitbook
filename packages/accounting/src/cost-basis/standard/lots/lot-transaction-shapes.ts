import type { AssetMovementDraft, FeeMovementDraft, Transaction } from '@exitbook/core';

import type { AccountingTransactionView } from '../../../accounting-layer/accounting-layer-types.js';
import type { AccountingScopedTransaction } from '../matching/scoped-transaction-types.js';

export type CostBasisTransactionLike = AccountingScopedTransaction | AccountingTransactionView | Transaction;

export function getRawTransaction(transaction: CostBasisTransactionLike): Transaction {
  if ('processedTransaction' in transaction) {
    return transaction.processedTransaction;
  }

  return 'tx' in transaction ? transaction.tx : transaction;
}

export function getTransactionMovements(transaction: CostBasisTransactionLike): {
  inflows: AssetMovementDraft[];
  outflows: AssetMovementDraft[];
} {
  if ('processedTransaction' in transaction) {
    return {
      inflows: transaction.inflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        grossAmount: movement.grossQuantity,
        movementRole: movement.role,
        netAmount: movement.netQuantity,
        priceAtTxTime: movement.priceAtTxTime,
        movementFingerprint: movement.movementFingerprint,
      })),
      outflows: transaction.outflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        grossAmount: movement.grossQuantity,
        movementRole: movement.role,
        netAmount: movement.netQuantity,
        priceAtTxTime: movement.priceAtTxTime,
        movementFingerprint: movement.movementFingerprint,
      })),
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
