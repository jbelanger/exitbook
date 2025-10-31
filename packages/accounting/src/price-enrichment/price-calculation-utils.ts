import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';

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
    const price = parseDecimal(outflow.amount.toFixed()).dividedBy(parseDecimal(inflow.amount.toFixed()));

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
    const price = parseDecimal(inflow.amount.toFixed()).dividedBy(parseDecimal(outflow.amount.toFixed()));

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
