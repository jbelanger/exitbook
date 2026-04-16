import type { AssetMovement, Transaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { PreparedAccountingTransaction, PreparedFeeMovement } from '../prepared-accounting-types.js';

export function clonePreparedAccountingTransaction(tx: Transaction): PreparedAccountingTransaction {
  const inflows: AssetMovement[] = [];
  for (const raw of tx.movements.inflows ?? []) {
    inflows.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      grossAmount: new Decimal(raw.grossAmount.toString()),
      movementRole: raw.movementRole,
      netAmount: raw.netAmount !== undefined ? new Decimal(raw.netAmount.toString()) : undefined,
      priceAtTxTime: raw.priceAtTxTime,
      movementFingerprint: raw.movementFingerprint,
    });
  }

  const outflows: AssetMovement[] = [];
  for (const raw of tx.movements.outflows ?? []) {
    outflows.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      grossAmount: new Decimal(raw.grossAmount.toString()),
      movementRole: raw.movementRole,
      netAmount: raw.netAmount !== undefined ? new Decimal(raw.netAmount.toString()) : undefined,
      priceAtTxTime: raw.priceAtTxTime,
      movementFingerprint: raw.movementFingerprint,
    });
  }

  const fees: PreparedFeeMovement[] = [];
  for (const raw of tx.fees ?? []) {
    fees.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      amount: new Decimal(raw.amount.toString()),
      movementFingerprint: raw.movementFingerprint,
      originalTransactionId: tx.id,
      scope: raw.scope,
      settlement: raw.settlement,
      priceAtTxTime: raw.priceAtTxTime,
    });
  }

  return {
    tx,
    rebuildDependencyTransactionIds: [],
    movements: { inflows, outflows },
    fees,
  };
}
