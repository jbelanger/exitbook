import type { AssetMovementDraft, FeeMovementDraft, Transaction } from '@exitbook/core';
import { computePrimaryMovement } from '@exitbook/core';
import { isFiat, type Currency } from '@exitbook/foundation';

import type { FeeDisplayItem, MovementDisplayItem, TransactionViewItem } from './transactions-view-model.js';

function isFiatAsset(assetSymbol: string): boolean {
  return isFiat(assetSymbol as Currency);
}

function toMovementDisplayItem(movement: AssetMovementDraft): MovementDisplayItem {
  return {
    assetSymbol: movement.assetSymbol,
    amount: movement.grossAmount.toFixed(),
    priceAtTxTime: movement.priceAtTxTime
      ? { price: `$${movement.priceAtTxTime.price.amount.toFixed(2)}`, source: movement.priceAtTxTime.source }
      : undefined,
  };
}

function toFeeDisplayItem(fee: FeeMovementDraft): FeeDisplayItem {
  return {
    assetSymbol: fee.assetSymbol,
    amount: fee.amount.toFixed(),
    scope: fee.scope,
    settlement: fee.settlement,
    priceAtTxTime: fee.priceAtTxTime
      ? { price: `$${fee.priceAtTxTime.price.amount.toFixed(2)}`, source: fee.priceAtTxTime.source }
      : undefined,
  };
}

export function getTransactionPriceStatus(tx: Transaction): TransactionViewItem['priceStatus'] {
  const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];
  const nonFiatMovements = allMovements.filter((movement) => !isFiatAsset(movement.assetSymbol));

  if (nonFiatMovements.length === 0) {
    return 'not-needed';
  }

  const pricedMovements = nonFiatMovements.filter((movement) => movement.priceAtTxTime !== undefined);

  if (pricedMovements.length === nonFiatMovements.length) {
    return 'all';
  }

  if (pricedMovements.length === 0) {
    return 'none';
  }

  return 'partial';
}

export function toTransactionViewItem(tx: Transaction): TransactionViewItem {
  const primaryMovement = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

  return {
    id: tx.id,
    platformKey: tx.platformKey,
    platformKind: tx.blockchain ? 'blockchain' : 'exchange',
    txFingerprint: tx.txFingerprint,
    datetime: tx.datetime,
    operationCategory: tx.operation.category,
    operationType: tx.operation.type,
    primaryAsset: primaryMovement?.assetSymbol ?? undefined,
    primaryAmount: primaryMovement?.amount.toFixed() ?? undefined,
    primaryDirection: primaryMovement?.direction === 'neutral' ? undefined : (primaryMovement?.direction ?? undefined),
    inflows: (tx.movements.inflows ?? []).map(toMovementDisplayItem),
    outflows: (tx.movements.outflows ?? []).map(toMovementDisplayItem),
    fees: (tx.fees ?? []).map(toFeeDisplayItem),
    priceStatus: getTransactionPriceStatus(tx),
    blockchain: tx.blockchain
      ? {
          name: tx.blockchain.name,
          blockHeight: tx.blockchain.block_height,
          transactionHash: tx.blockchain.transaction_hash,
          isConfirmed: tx.blockchain.is_confirmed,
        }
      : undefined,
    from: tx.from ?? undefined,
    to: tx.to ?? undefined,
    notes: (tx.notes ?? []).map((note) => ({
      type: note.type,
      message: note.message,
      severity: note.severity,
    })),
    excludedFromAccounting: tx.excludedFromAccounting ?? false,
    isSpam: tx.isSpam ?? false,
  };
}
