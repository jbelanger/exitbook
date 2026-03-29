/**
 * Pure price inference rules for price enrichment.
 *
 * This module owns the business logic for:
 * - multi-pass price inference
 * - link-based price rederive across platforms
 * - fee price enrichment from movement prices
 *
 * All functions are pure (no side effects, no DB access, no logging).
 */

import type { AssetMovementDraft, PriceAtTxTime, Transaction } from '@exitbook/core';
import { isFiat, isFiatOrStablecoin, parseDecimal } from '@exitbook/foundation';

import type { LinkedTransactionGroup } from '../shared/types.js';

import { enrichMovementsWithPrices } from './movement-enrichment-utils.js';
import { calculatePriceFromTrade, extractTradeMovements, stampFiatIdentityPrices } from './price-calculation-utils.js';

type TransactionMovement = NonNullable<Transaction['movements']['inflows']>[number];
type TransactionFee = Transaction['fees'][number];

interface InferMultiPassResult {
  transactions: Transaction[];
  modifiedIds: Set<number>;
}

interface PassResult<TMovement extends AssetMovementDraft = AssetMovementDraft> {
  enrichedMovements: Map<number, { inflows: TMovement[]; outflows: TMovement[] }>;
  modifiedIds: Set<number>;
}

interface PropagatePricesResult {
  enrichedTransactions: Transaction[];
  modifiedIds: Set<number>;
}

function replaceTransactionMovements(
  tx: Transaction,
  movements: {
    inflows: TransactionMovement[];
    outflows: TransactionMovement[];
  }
): Transaction {
  return {
    ...tx,
    movements,
  };
}

function replaceTransactionFees(tx: Transaction, fees: TransactionFee[]): Transaction {
  return {
    ...tx,
    fees,
  };
}

function applyExchangeExecutionPrices(transactions: Transaction[]): PassResult<TransactionMovement> {
  const enrichedMovements = new Map<number, { inflows: TransactionMovement[]; outflows: TransactionMovement[] }>();

  for (const tx of transactions) {
    const timestamp = new Date(tx.datetime).getTime();
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    const trade = extractTradeMovements(inflows, outflows, timestamp);
    let currentInflows = inflows;
    let currentOutflows = outflows;

    if (trade) {
      const tradePrices = calculatePriceFromTrade(trade);

      if (tradePrices.length > 0) {
        const pricesMap = new Map(tradePrices.map((p) => [p.assetSymbol, p.priceAtTxTime]));
        currentInflows = enrichMovementsWithPrices(inflows, pricesMap);
        currentOutflows = enrichMovementsWithPrices(outflows, pricesMap);
      }
    }

    const allMovements = [...currentInflows, ...currentOutflows];
    const fiatIdentityPrices = stampFiatIdentityPrices(allMovements, timestamp);

    if (fiatIdentityPrices.length > 0) {
      const fiatPricesMap = new Map(fiatIdentityPrices.map((p) => [p.assetSymbol, p.priceAtTxTime]));
      currentInflows = enrichMovementsWithPrices(currentInflows, fiatPricesMap);
      currentOutflows = enrichMovementsWithPrices(currentOutflows, fiatPricesMap);
    }

    if (currentInflows !== inflows || currentOutflows !== outflows) {
      enrichedMovements.set(tx.id, {
        inflows: currentInflows,
        outflows: currentOutflows,
      });
    }
  }

  return {
    enrichedMovements,
    modifiedIds: new Set(),
  };
}

function deriveInflowPricesFromOutflows(
  transactions: Transaction[],
  previousMovements: Map<number, { inflows: TransactionMovement[]; outflows: TransactionMovement[] }>
): PassResult<TransactionMovement> {
  const enrichedMovements = new Map(previousMovements);
  const modifiedIds = new Set<number>();

  for (const tx of transactions) {
    const enriched = enrichedMovements.get(tx.id);
    const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
    const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
    const timestamp = new Date(tx.datetime).getTime();

    const trade = extractTradeMovements(inflows, outflows, timestamp);
    if (!trade) {
      continue;
    }

    if (trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
      continue;
    }

    const ratio = trade.outflow.grossAmount.dividedBy(trade.inflow.grossAmount);
    const derivedPrice = trade.outflow.priceAtTxTime.price.amount.times(ratio);

    const derivedPriceAtTxTime: PriceAtTxTime = {
      price: {
        amount: derivedPrice,
        currency: trade.outflow.priceAtTxTime.price.currency,
      },
      source: 'derived-ratio',
      fetchedAt: new Date(timestamp),
      granularity: trade.outflow.priceAtTxTime.granularity,
    };

    const pricesMap = new Map([[trade.inflow.assetSymbol, derivedPriceAtTxTime]]);
    const updatedInflows = enrichMovementsWithPrices(inflows, pricesMap);

    enrichedMovements.set(tx.id, {
      inflows: updatedInflows,
      outflows,
    });

    modifiedIds.add(tx.id);
  }

  return { enrichedMovements, modifiedIds };
}

function recalculateCryptoSwapRatios(
  transactions: Transaction[],
  previousMovements: Map<number, { inflows: TransactionMovement[]; outflows: TransactionMovement[] }>
): PassResult<TransactionMovement> {
  const enrichedMovements = new Map(previousMovements);
  const modifiedIds = new Set<number>();

  for (const tx of transactions) {
    const enriched = enrichedMovements.get(tx.id);
    const inflows = enriched ? enriched.inflows : (tx.movements.inflows ?? []);
    const outflows = enriched ? enriched.outflows : (tx.movements.outflows ?? []);
    const timestamp = new Date(tx.datetime).getTime();

    const trade = extractTradeMovements(inflows, outflows, timestamp);
    if (!trade) {
      continue;
    }

    if (!trade.inflow.priceAtTxTime || !trade.outflow.priceAtTxTime) {
      continue;
    }

    const inflowCurrency = trade.inflow.assetSymbol;
    const outflowCurrency = trade.outflow.assetSymbol;

    if (isFiatOrStablecoin(inflowCurrency) || isFiatOrStablecoin(outflowCurrency)) {
      continue;
    }

    const ratio = parseDecimal(trade.outflow.grossAmount.toFixed()).dividedBy(
      parseDecimal(trade.inflow.grossAmount.toFixed())
    );
    const derivedPrice = parseDecimal(trade.outflow.priceAtTxTime.price.amount.toFixed()).times(ratio);

    const derivedPriceAtTxTime: PriceAtTxTime = {
      price: {
        amount: derivedPrice,
        currency: trade.outflow.priceAtTxTime.price.currency,
      },
      source: 'derived-ratio',
      fetchedAt: new Date(timestamp),
      granularity: trade.outflow.priceAtTxTime.granularity,
    };

    const pricesMap = new Map([[trade.inflow.assetSymbol, derivedPriceAtTxTime]]);
    const updatedInflows = enrichMovementsWithPrices(inflows, pricesMap);

    enrichedMovements.set(tx.id, {
      inflows: updatedInflows,
      outflows,
    });

    modifiedIds.add(tx.id);
  }

  return { enrichedMovements, modifiedIds };
}

export function inferMultiPass(transactions: Transaction[]): InferMultiPassResult {
  const pass0 = applyExchangeExecutionPrices(transactions);
  const pass1 = deriveInflowPricesFromOutflows(transactions, pass0.enrichedMovements);
  const pass2 = recalculateCryptoSwapRatios(transactions, pass1.enrichedMovements);

  const enrichedTransactions = transactions.map((tx) => {
    const enriched = pass2.enrichedMovements.get(tx.id);
    if (enriched) {
      return replaceTransactionMovements(tx, {
        inflows: enriched.inflows,
        outflows: enriched.outflows,
      });
    }
    return tx;
  });

  const modifiedIds = new Set([...pass1.modifiedIds, ...pass2.modifiedIds]);

  return {
    transactions: enrichedTransactions,
    modifiedIds,
  };
}

export function propagatePricesAcrossLinks(
  group: LinkedTransactionGroup,
  transactions: Transaction[]
): PropagatePricesResult {
  const { linkChain } = group;
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));
  const enrichedMovements = new Map<number, { inflows: TransactionMovement[]; outflows: TransactionMovement[] }>();

  for (const link of linkChain) {
    const sourceTx = txMap.get(link.sourceTransactionId);
    const targetTx = txMap.get(link.targetTransactionId);

    if (!sourceTx || !targetTx) {
      continue;
    }

    const sourceOutflows = sourceTx.movements.outflows ?? [];
    const targetInflows = targetTx.movements.inflows ?? [];
    const targetMovementPrices: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

    for (const sourceMovement of sourceOutflows) {
      if (!sourceMovement.priceAtTxTime) {
        continue;
      }

      for (const targetMovement of targetInflows) {
        if (targetMovement.assetSymbol === sourceMovement.assetSymbol) {
          const sourceAmount = sourceMovement.grossAmount.toNumber();
          const targetAmount = targetMovement.grossAmount.toNumber();
          const amountDiff = Math.abs(sourceAmount - targetAmount);
          const amountTolerance = sourceAmount * 0.1;

          if (amountDiff <= amountTolerance) {
            const propagatedPrice: PriceAtTxTime = {
              ...sourceMovement.priceAtTxTime,
              source: 'link-propagated',
            };

            targetMovementPrices.push({
              asset: targetMovement.assetSymbol,
              priceAtTxTime: propagatedPrice,
            });

            break;
          }
        }
      }
    }

    if (targetMovementPrices.length > 0) {
      const pricesMap = new Map(targetMovementPrices.map((p) => [p.asset, p.priceAtTxTime] as const));
      const enrichedInflows = enrichMovementsWithPrices(targetInflows, pricesMap);
      const targetOutflows = targetTx.movements.outflows ?? [];

      enrichedMovements.set(targetTx.id, {
        inflows: enrichedInflows,
        outflows: targetOutflows,
      });
    }
  }

  const enrichedTransactions = transactions.map((tx) => {
    const enriched = enrichedMovements.get(tx.id);
    if (enriched) {
      return replaceTransactionMovements(tx, {
        inflows: enriched.inflows,
        outflows: enriched.outflows,
      });
    }
    return tx;
  });

  const modifiedIds = new Set(enrichedMovements.keys());

  return {
    enrichedTransactions,
    modifiedIds,
  };
}

export function enrichFeePricesFromMovements(transactions: Transaction[]): Transaction[] {
  return transactions.map((tx) => {
    const timestamp = new Date(tx.datetime).getTime();
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];
    const allMovements = [...inflows, ...outflows];

    const pricesByAsset = new Map<string, PriceAtTxTime>();
    for (const movement of allMovements) {
      if (movement.priceAtTxTime && !pricesByAsset.has(movement.assetSymbol)) {
        pricesByAsset.set(movement.assetSymbol, movement.priceAtTxTime);
      }
    }

    const fees = tx.fees ?? [];
    if (fees.length === 0) {
      return tx;
    }

    let feesModified = false;
    const enrichedFees = fees.map((fee) => {
      if (fee.priceAtTxTime) {
        return fee;
      }

      const price = pricesByAsset.get(fee.assetSymbol);
      if (price) {
        feesModified = true;
        return { ...fee, priceAtTxTime: price };
      }

      return fee;
    });

    const finalFees = enrichedFees.map((fee) => {
      if (fee.priceAtTxTime) {
        return fee;
      }

      const currency = fee.assetSymbol;

      if (!isFiat(currency)) {
        return fee;
      }

      const isUSD = currency === 'USD';
      feesModified = true;

      return {
        ...fee,
        priceAtTxTime: {
          price: { amount: parseDecimal('1'), currency },
          source: isUSD ? ('exchange-execution' as const) : ('fiat-execution-tentative' as const),
          fetchedAt: new Date(timestamp),
          granularity: 'exact' as const,
        },
      };
    });

    if (feesModified) {
      return replaceTransactionFees(tx, finalFees);
    }

    return tx;
  });
}
