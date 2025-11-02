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
 * Calculate price from trade movements when one side is actual USD
 * Returns price for the non-USD currency in terms of USD
 *
 * IMPORTANT: Only derives from actual USD, not stablecoins or other fiat
 * - USD trades ✅ (derive execution price)
 * - EUR/CAD/GBP trades ❌ (normalized to USD in Stage 1 via FX providers)
 * - USDC/USDT/DAI trades ❌ (fetched in Stage 3 to capture de-peg events)
 *
 * Logic:
 * - If outflow is USD: price of inflow = outflow amount / inflow amount
 * - If inflow is USD: price of outflow = inflow amount / outflow amount
 * - If both are USD: skip (same currency)
 * - If neither is USD: return empty (can't derive)
 *
 * Example: Buy 1 BTC with 50,000 USD
 *   - Outflow: 50,000 USD (actual USD)
 *   - Inflow: 1 BTC (crypto)
 *   - Price: 50,000 USD/BTC
 */
export function calculatePriceFromTrade(movements: TradeMovements): { asset: string; priceAtTxTime: PriceAtTxTime }[] {
  const { inflow, outflow, timestamp } = movements;

  const inflowCurrency = Currency.create(inflow.asset);
  const outflowCurrency = Currency.create(outflow.asset);

  // Only derive from actual USD (not stablecoins, not other fiat)
  const inflowIsUSD = inflowCurrency.toString() === 'USD';
  const outflowIsUSD = outflowCurrency.toString() === 'USD';

  // Neither side is USD - can't derive price
  // This includes:
  // - EUR trades (normalized separately in Stage 1)
  // - USDC trades (fetched separately in Stage 3 with actual historical prices)
  // - Crypto-crypto swaps (handled by Pass N+2)
  if (!inflowIsUSD && !outflowIsUSD) {
    return [];
  }

  const results: { asset: string; priceAtTxTime: PriceAtTxTime }[] = [];

  // Outflow is USD - calculate price of inflow
  if (outflowIsUSD && !inflowIsUSD) {
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

  // Inflow is USD - calculate price of outflow
  if (inflowIsUSD && !outflowIsUSD) {
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

  // Both sides are USD - skip (same currency, no price derivation needed)
  // This case is theoretically impossible but handle for completeness

  return results;
}
