import {
  buildTransactionBalanceImpact,
  collectTransactionBalanceImpactPricingInputs,
  type Transaction,
} from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { PortfolioTransactionItem } from './portfolio-history-types.js';

export function filterTransactionsForAssets(transactions: Transaction[], assetIds: string[]): Transaction[] {
  const assetIdSet = new Set(assetIds);
  return transactions.filter((tx) => {
    const inInflows = (tx.movements.inflows ?? []).some((movement) => assetIdSet.has(movement.assetId));
    const inOutflows = (tx.movements.outflows ?? []).some((movement) => assetIdSet.has(movement.assetId));
    const inFees = (tx.fees ?? []).some((movement) => assetIdSet.has(movement.assetId));
    return inInflows || inOutflows || inFees;
  });
}

export function filterTransactionsForAsset(transactions: Transaction[], assetId: string): Transaction[] {
  return filterTransactionsForAssets(transactions, [assetId]);
}

export function buildAssetIdsBySymbol(transactions: Transaction[]): Map<string, string[]> {
  const assetIdsBySymbol = new Map<string, Set<string>>();

  const addMovement = (assetId: string, assetSymbol: string): void => {
    const normalizedSymbol = assetSymbol.trim().toUpperCase();
    if (normalizedSymbol.length === 0) {
      return;
    }

    const existing = assetIdsBySymbol.get(normalizedSymbol);
    if (existing) {
      existing.add(assetId);
    } else {
      assetIdsBySymbol.set(normalizedSymbol, new Set([assetId]));
    }
  };

  for (const tx of transactions) {
    for (const inflow of tx.movements.inflows ?? []) {
      addMovement(inflow.assetId, inflow.assetSymbol);
    }
    for (const outflow of tx.movements.outflows ?? []) {
      addMovement(outflow.assetId, outflow.assetSymbol);
    }
    for (const fee of tx.fees ?? []) {
      addMovement(fee.assetId, fee.assetSymbol);
    }
  }

  return new Map(Array.from(assetIdsBySymbol.entries()).map(([symbol, assetIds]) => [symbol, Array.from(assetIds)]));
}

export function buildTransactionItems(
  transactions: Transaction[],
  assetIds: string | string[]
): PortfolioTransactionItem[] {
  const items: PortfolioTransactionItem[] = [];
  const assetIdSet = new Set(Array.isArray(assetIds) ? assetIds : [assetIds]);

  for (const tx of transactions) {
    const netAmount = buildTransactionBalanceImpact(tx).assets.reduce((sum, assetImpact) => {
      if (!assetIdSet.has(assetImpact.assetId)) {
        return sum;
      }

      return sum.plus(assetImpact.netBalanceDelta);
    }, new Decimal(0));

    const assetDirection: 'in' | 'out' = netAmount.gte(0) ? 'in' : 'out';
    const inflows = (tx.movements.inflows ?? []).map((inflow) => ({
      amount: inflow.grossAmount.toFixed(8),
      assetSymbol: inflow.assetSymbol,
    }));
    const outflows = (tx.movements.outflows ?? []).map((outflow) => ({
      amount: outflow.grossAmount.toFixed(8),
      assetSymbol: outflow.assetSymbol,
    }));
    const fees = (tx.fees ?? []).map((fee) => ({
      amount: fee.amount.toFixed(8),
      assetSymbol: fee.assetSymbol,
    }));

    const fiatValue = computeTransactionFiatValue(tx, assetIdSet, netAmount.abs());
    const { transferDirection, transferPeer } = extractTransferContext(tx, assetDirection);

    items.push({
      id: tx.id,
      datetime: tx.datetime,
      operationCategory: tx.operation.category,
      operationType: tx.operation.type,
      platformKey: tx.platformKey,
      assetAmount: netAmount.abs().toFixed(8),
      assetDirection,
      ...(fiatValue !== undefined && { fiatValue }),
      ...(transferPeer !== undefined && { transferPeer }),
      ...(transferDirection !== undefined && { transferDirection }),
      inflows,
      outflows,
      fees,
    });
  }

  items.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  return items;
}

function computeTransactionFiatValue(
  tx: Transaction,
  assetIdSet: Set<string>,
  absoluteNetAmount: Decimal
): string | undefined {
  if (absoluteNetAmount.isZero()) {
    return undefined;
  }

  const pricingInputs = collectTransactionBalanceImpactPricingInputs(tx, assetIdSet);
  const weightedPriceSum = pricingInputs.reduce(
    (sum, pricingInput) => sum.plus(pricingInput.priceAtTxTime.price.amount.times(pricingInput.amount)),
    new Decimal(0)
  );
  const pricedQuantity = pricingInputs.reduce((sum, pricingInput) => sum.plus(pricingInput.amount), new Decimal(0));

  if (pricedQuantity.isZero()) {
    return undefined;
  }

  const weightedUnitPrice = weightedPriceSum.div(pricedQuantity);
  return weightedUnitPrice.times(absoluteNetAmount).toFixed(2);
}

function extractTransferContext(
  tx: Transaction,
  assetDirection: 'in' | 'out'
): { transferDirection?: 'to' | 'from' | undefined; transferPeer?: string | undefined } {
  if (tx.operation.category !== 'transfer') {
    return {};
  }

  if (assetDirection === 'out') {
    return {
      transferDirection: 'to',
      transferPeer: tx.to,
    };
  }

  return {
    transferDirection: 'from',
    transferPeer: tx.from,
  };
}
