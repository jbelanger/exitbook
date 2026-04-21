import type { AssetMovement, FeeMovement, Transaction, TransactionBalanceImpactAssetEntry } from '@exitbook/core';
import { buildTransactionBalanceImpact, computePrimaryMovement } from '@exitbook/core';
import { isFiat, type Currency } from '@exitbook/foundation';
import { deriveOperationLabel, type TransactionAnnotation } from '@exitbook/transaction-interpretation';

import {
  createAddressOwnershipLookup,
  resolveAddressOwnership,
  type AddressOwnershipLookup,
} from '../shared/address-ownership.js';

import { buildAnnotationsByTransactionId } from './transactions-annotation-utils.js';
import type { FeeDisplayItem, MovementDisplayItem, TransactionViewItem } from './transactions-view-model.js';

const EMPTY_ADDRESS_OWNERSHIP_LOOKUP = createAddressOwnershipLookup({});

function isFiatAsset(assetSymbol: string): boolean {
  return isFiat(assetSymbol as Currency);
}

function toMovementDisplayItem(movement: AssetMovement): MovementDisplayItem {
  return {
    movementFingerprint: movement.movementFingerprint,
    movementRole: movement.movementRole ?? 'principal',
    assetSymbol: movement.assetSymbol,
    amount: movement.grossAmount.toFixed(),
    priceAtTxTime: movement.priceAtTxTime
      ? { price: `$${movement.priceAtTxTime.price.amount.toFixed(2)}`, source: movement.priceAtTxTime.source }
      : undefined,
  };
}

function toFeeDisplayItem(fee: FeeMovement): FeeDisplayItem {
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

function formatBalanceImpactAmount(amount: AssetMovement['grossAmount']): string {
  const numericAmount = Number.parseFloat(amount.toFixed());

  if (Number.isNaN(numericAmount)) {
    return amount.toFixed();
  }

  return numericAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function orderBalanceImpactAssetsForDisplay(
  assetImpactsById: ReadonlyMap<string, TransactionBalanceImpactAssetEntry>,
  orderedAssetIds: readonly string[],
  getAmount: (entry: TransactionBalanceImpactAssetEntry) => AssetMovement['grossAmount']
): TransactionBalanceImpactAssetEntry[] {
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

  for (const assetImpact of assetImpactsById.values()) {
    if (seenAssetIds.has(assetImpact.assetId) || getAmount(assetImpact).isZero()) {
      continue;
    }

    orderedEntries.push(assetImpact);
  }

  return orderedEntries;
}

function formatBalanceImpactSummary(
  orderedEntries: readonly TransactionBalanceImpactAssetEntry[],
  getAmount: (entry: TransactionBalanceImpactAssetEntry) => AssetMovement['grossAmount']
): string | undefined {
  if (orderedEntries.length === 0) {
    return undefined;
  }

  return orderedEntries
    .map((assetImpact) => `${formatBalanceImpactAmount(getAmount(assetImpact))} ${assetImpact.assetSymbol}`)
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

export function toTransactionViewItem(
  tx: Transaction,
  addressOwnershipLookup?: AddressOwnershipLookup,
  annotations: readonly TransactionAnnotation[] = []
): TransactionViewItem {
  const resolvedAddressOwnershipLookup = addressOwnershipLookup ?? EMPTY_ADDRESS_OWNERSHIP_LOOKUP;
  const primaryMovement = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);
  const balanceImpact = buildTransactionBalanceImpact(tx);
  const balanceImpactAssetsById = new Map(
    balanceImpact.assets.map((assetImpact) => [assetImpact.assetId, assetImpact])
  );
  const derivedOperation = deriveOperationLabel(tx, annotations);

  return {
    id: tx.id,
    platformKey: tx.platformKey,
    platformKind: tx.platformKind,
    txFingerprint: tx.txFingerprint,
    datetime: tx.datetime,
    operationGroup: derivedOperation.group,
    operationLabel: derivedOperation.label,
    operationCategory: tx.operation.category,
    operationType: tx.operation.type,
    debitSummary: formatBalanceImpactSummary(
      orderBalanceImpactAssetsForDisplay(
        balanceImpactAssetsById,
        (tx.movements.outflows ?? []).map((movement) => movement.assetId),
        (assetImpact) => assetImpact.debitGross
      ),
      (assetImpact) => assetImpact.debitGross
    ),
    creditSummary: formatBalanceImpactSummary(
      orderBalanceImpactAssetsForDisplay(
        balanceImpactAssetsById,
        (tx.movements.inflows ?? []).map((movement) => movement.assetId),
        (assetImpact) => assetImpact.creditGross
      ),
      (assetImpact) => assetImpact.creditGross
    ),
    feeSummary: formatBalanceImpactSummary(
      orderBalanceImpactAssetsForDisplay(
        balanceImpactAssetsById,
        (tx.fees ?? []).filter((fee) => fee.settlement !== 'on-chain').map((fee) => fee.assetId),
        (assetImpact) => assetImpact.separateFeeDebit
      ),
      (assetImpact) => assetImpact.separateFeeDebit
    ),
    primaryMovementAsset: primaryMovement?.assetSymbol ?? undefined,
    primaryMovementAmount: primaryMovement?.amount.toFixed() ?? undefined,
    primaryMovementDirection:
      primaryMovement?.direction === 'neutral' ? undefined : (primaryMovement?.direction ?? undefined),
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
    fromOwnership: resolveAddressOwnership(tx.from ?? undefined, resolvedAddressOwnershipLookup),
    to: tx.to ?? undefined,
    toOwnership: resolveAddressOwnership(tx.to ?? undefined, resolvedAddressOwnershipLookup),
    annotations: [...annotations],
    diagnostics: (tx.diagnostics ?? []).map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
    })),
    userNotes: (tx.userNotes ?? []).map((userNote) => ({
      author: userNote.author,
      createdAt: userNote.createdAt,
      message: userNote.message,
    })),
    excludedFromAccounting: tx.excludedFromAccounting ?? false,
  };
}

export function toTransactionViewItems(
  transactions: readonly Transaction[],
  addressOwnershipLookup?: AddressOwnershipLookup,
  annotations: readonly TransactionAnnotation[] = []
): TransactionViewItem[] {
  const annotationsByTransactionId = buildAnnotationsByTransactionId(annotations);

  return transactions.map((transaction) =>
    toTransactionViewItem(transaction, addressOwnershipLookup, annotationsByTransactionId.get(transaction.id) ?? [])
  );
}
