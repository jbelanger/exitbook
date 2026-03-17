import type { Transaction } from '@exitbook/core';

export interface KnownAssetRecord {
  assetId: string;
  assetSymbols: string[];
  movementCount: number;
  transactionCount: number;
}

interface MutableKnownAssetRecord {
  assetId: string;
  assetSymbols: Set<string>;
  movementCount: number;
  transactionIds: Set<number>;
}

function addAssetOccurrence(
  assetsById: Map<string, MutableKnownAssetRecord>,
  transactionId: number,
  assetId: string,
  assetSymbol: string
): void {
  const existing = assetsById.get(assetId);
  if (existing) {
    existing.assetSymbols.add(assetSymbol);
    existing.movementCount += 1;
    existing.transactionIds.add(transactionId);
    return;
  }

  assetsById.set(assetId, {
    assetId,
    assetSymbols: new Set([assetSymbol]),
    movementCount: 1,
    transactionIds: new Set([transactionId]),
  });
}

export function collectKnownAssets(transactions: Transaction[]): Map<string, KnownAssetRecord> {
  const assetsById = new Map<string, MutableKnownAssetRecord>();

  for (const transaction of transactions) {
    for (const inflow of transaction.movements.inflows ?? []) {
      addAssetOccurrence(assetsById, transaction.id, inflow.assetId, inflow.assetSymbol);
    }

    for (const outflow of transaction.movements.outflows ?? []) {
      addAssetOccurrence(assetsById, transaction.id, outflow.assetId, outflow.assetSymbol);
    }

    for (const fee of transaction.fees) {
      addAssetOccurrence(assetsById, transaction.id, fee.assetId, fee.assetSymbol);
    }
  }

  const immutableAssets = new Map<string, KnownAssetRecord>();
  for (const [assetId, record] of assetsById) {
    immutableAssets.set(assetId, {
      assetId,
      assetSymbols: [...record.assetSymbols].sort((left, right) => left.localeCompare(right)),
      movementCount: record.movementCount,
      transactionCount: record.transactionIds.size,
    });
  }

  return immutableAssets;
}

export function findAssetsBySymbol(knownAssets: Iterable<KnownAssetRecord>, rawSymbol: string): KnownAssetRecord[] {
  const normalizedSymbol = rawSymbol.trim().toUpperCase();

  return [...knownAssets]
    .filter((asset) => asset.assetSymbols.some((symbol) => symbol.toUpperCase() === normalizedSymbol))
    .sort((left, right) => {
      if (right.transactionCount !== left.transactionCount) {
        return right.transactionCount - left.transactionCount;
      }

      return left.assetId.localeCompare(right.assetId);
    });
}
