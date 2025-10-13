import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';

/**
 * Detected trade pattern with both sides of the trade
 */
export interface TradeMovements {
  inflow: AssetMovement;
  outflow: AssetMovement;
  fee?: AssetMovement | undefined;
  timestamp: number;
}

/**
 * Detect if movements form a simple trade pattern (1 inflow + 1 outflow)
 * Returns undefined if pattern doesn't match
 */
export function extractTradeMovements(
  inflows: AssetMovement[],
  outflows: AssetMovement[],
  timestamp: number
): TradeMovements | undefined {
  // Simple trade: exactly 1 inflow and 1 outflow
  // (fees are tracked separately, not as movements)
  if (inflows.length !== 1 || outflows.length !== 1) {
    return undefined;
  }

  const inflow = inflows[0];
  const outflow = outflows[0];

  if (!inflow || !outflow) {
    return undefined;
  }

  return {
    inflow,
    outflow,
    timestamp,
  };
}

/**
 * Calculate price from trade movements when one side is fiat/stablecoin
 * Returns price for the non-fiat currency in terms of the fiat currency
 *
 * Logic:
 * - If outflow is fiat/stablecoin: price of inflow = outflow amount / inflow amount
 * - If inflow is fiat/stablecoin: price of outflow = inflow amount / outflow amount
 * - If both are fiat/stablecoin: return price for both (useful for stablecoin swaps)
 * - If neither is fiat/stablecoin: return undefined (can't determine price)
 *
 * Example: Buy 1 BTC with 50,000 USDT
 *   - Outflow: 50,000 USDT (fiat/stablecoin)
 *   - Inflow: 1 BTC (crypto)
 *   - Price: 50,000 USDT/BTC
 */
export function calculatePriceFromTrade(movements: TradeMovements): { asset: string; priceAtTxTime: PriceAtTxTime }[] {
  const { inflow, outflow, timestamp } = movements;

  const inflowCurrency = Currency.create(inflow.asset);
  const outflowCurrency = Currency.create(outflow.asset);

  const inflowIsFiatOrStable = inflowCurrency.isFiatOrStablecoin();
  const outflowIsFiatOrStable = outflowCurrency.isFiatOrStablecoin();

  // Neither side is fiat/stablecoin - can't determine price
  if (!inflowIsFiatOrStable && !outflowIsFiatOrStable) {
    return [];
  }

  const results: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

  // Outflow is fiat/stablecoin - calculate price of inflow
  if (outflowIsFiatOrStable) {
    const price = new Decimal(outflow.amount.amount.toString()).dividedBy(new Decimal(inflow.amount.amount.toString()));

    results.push({
      asset: inflow.asset,
      priceAtTxTime: {
        price: { amount: price, currency: outflowCurrency },
        source: 'exchange-execution',
        fetchedAt: new Date(timestamp),
        granularity: 'exact',
      },
    });
  }

  // Inflow is fiat/stablecoin - calculate price of outflow
  if (inflowIsFiatOrStable) {
    const price = new Decimal(inflow.amount.amount.toString()).dividedBy(new Decimal(outflow.amount.amount.toString()));

    results.push({
      asset: outflow.asset,
      priceAtTxTime: {
        price: { amount: price, currency: inflowCurrency },
        source: 'exchange-execution',
        fetchedAt: new Date(timestamp),
        granularity: 'exact',
      },
    });
  }

  return results;
}

/**
 * Find closest price in a price index within a time window
 * Returns undefined if no price found within window
 */
export function findClosestPrice(
  asset: string,
  targetTimestamp: number,
  priceIndex: Map<string, PriceAtTxTime[]>,
  maxTimeDeltaMs: number
): PriceAtTxTime | undefined {
  const prices = priceIndex.get(asset);
  if (!prices || prices.length === 0) {
    return undefined;
  }

  let closest: PriceAtTxTime | undefined;
  let minDelta = Number.POSITIVE_INFINITY;

  for (const price of prices) {
    const delta = Math.abs(price.fetchedAt.getTime() - targetTimestamp);

    if (delta <= maxTimeDeltaMs && delta < minDelta) {
      minDelta = delta;
      closest = price;
    }
  }

  if (closest) {
    return {
      ...closest,
      source: 'derived-history',
      fetchedAt: new Date(targetTimestamp),
    };
  }

  return undefined;
}

/**
 * Infer price from crypto-crypto trade using existing price index
 * If we know the price of one side, calculate the price of the other side
 */
export function inferPriceFromTrade(
  movements: TradeMovements,
  priceIndex: Map<string, PriceAtTxTime[]>,
  maxTimeDeltaMs: number
): { asset: string; priceAtTxTime: PriceAtTxTime }[] {
  const { inflow, outflow, timestamp } = movements;

  // Skip if either side already has price
  if (inflow.priceAtTxTime || outflow.priceAtTxTime) {
    return [];
  }

  // Check if we know the price of either side
  const inflowPrice = findClosestPrice(inflow.asset, timestamp, priceIndex, maxTimeDeltaMs);
  const outflowPrice = findClosestPrice(outflow.asset, timestamp, priceIndex, maxTimeDeltaMs);

  const results: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

  // If we know inflow price, calculate outflow price
  if (inflowPrice && !outflowPrice) {
    // outflowPrice = inflowPrice * (inflow.amount / outflow.amount)
    const ratio = new Decimal(inflow.amount.amount.toString()).dividedBy(new Decimal(outflow.amount.amount.toString()));
    const derivedPrice = new Decimal(inflowPrice.price.amount.toString()).times(ratio);

    results.push({
      asset: outflow.asset,
      priceAtTxTime: {
        price: { amount: derivedPrice, currency: inflowPrice.price.currency },
        source: 'derived-trade',
        fetchedAt: new Date(timestamp),
        granularity: inflowPrice.granularity,
      },
    });
  }

  // If we know outflow price, calculate inflow price
  if (outflowPrice && !inflowPrice) {
    // inflowPrice = outflowPrice * (outflow.amount / inflow.amount)
    const ratio = new Decimal(outflow.amount.amount.toString()).dividedBy(new Decimal(inflow.amount.amount.toString()));
    const derivedPrice = new Decimal(outflowPrice.price.amount.toString()).times(ratio);

    results.push({
      asset: inflow.asset,
      priceAtTxTime: {
        price: { amount: derivedPrice, currency: outflowPrice.price.currency },
        source: 'derived-trade',
        fetchedAt: new Date(timestamp),
        granularity: outflowPrice.granularity,
      },
    });
  }

  return results;
}
