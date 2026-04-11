import type {
  AssetMovementDraft,
  FeeMovementDraft,
  Transaction,
  TransactionBalanceImpactAssetEntry,
} from '@exitbook/core';
import { buildTransactionBalanceImpact, computePrimaryMovement } from '@exitbook/core';
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

function formatSummaryAmount(amount: AssetMovementDraft['grossAmount']): string {
  const numericAmount = Number.parseFloat(amount.toFixed());

  if (Number.isNaN(numericAmount)) {
    return amount.toFixed();
  }

  return numericAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function buildBalanceImpactSummary(
  assetImpacts: readonly TransactionBalanceImpactAssetEntry[],
  orderedAssetIds: readonly string[],
  getAmount: (entry: TransactionBalanceImpactAssetEntry) => AssetMovementDraft['grossAmount']
): string | undefined {
  const assetImpactsById = new Map(assetImpacts.map((assetImpact) => [assetImpact.assetId, assetImpact]));
  const seenAssetIds = new Set<string>();
  const orderedEntries: TransactionBalanceImpactAssetEntry[] = [];

  for (const assetId of orderedAssetIds) {
    if (seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    const assetImpact = assetImpactsById.get(assetId);
    if (!assetImpact || getAmount(assetImpact).isZero()) {
      continue;
    }

    orderedEntries.push(assetImpact);
  }

  for (const assetImpact of assetImpacts) {
    if (seenAssetIds.has(assetImpact.assetId) || getAmount(assetImpact).isZero()) {
      continue;
    }

    orderedEntries.push(assetImpact);
  }

  if (orderedEntries.length === 0) {
    return undefined;
  }

  return orderedEntries
    .map((assetImpact) => `${formatSummaryAmount(getAmount(assetImpact))} ${assetImpact.assetSymbol}`)
    .join(' + ');
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
  const balanceImpact = buildTransactionBalanceImpact(tx);

  return {
    id: tx.id,
    platformKey: tx.platformKey,
    platformKind: tx.platformKind,
    txFingerprint: tx.txFingerprint,
    datetime: tx.datetime,
    operationCategory: tx.operation.category,
    operationType: tx.operation.type,
    debitSummary: buildBalanceImpactSummary(
      balanceImpact.assets,
      (tx.movements.outflows ?? []).map((movement) => movement.assetId),
      (assetImpact) => assetImpact.debitGross
    ),
    creditSummary: buildBalanceImpactSummary(
      balanceImpact.assets,
      (tx.movements.inflows ?? []).map((movement) => movement.assetId),
      (assetImpact) => assetImpact.creditGross
    ),
    feeSummary: buildBalanceImpactSummary(
      balanceImpact.assets,
      (tx.fees ?? []).filter((fee) => fee.settlement !== 'on-chain').map((fee) => fee.assetId),
      (assetImpact) => assetImpact.separateFeeDebit
    ),
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
