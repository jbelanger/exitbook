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
 * Calculate price from trade movements when one side is fiat currency
 * Returns prices for both sides in the native fiat currency
 *
 * Handles two cases:
 * 1. USD trades: Derive execution price in USD (highest confidence)
 * 2. Non-USD fiat trades: Derive prices in native currency (EUR, CAD, etc.)
 *    - Fiat gets identity price (1 CAD = 1 CAD)
 *    - Crypto gets price in that fiat currency
 *    - Stage 1 normalization then converts to USD via FX providers
 *
 * Does NOT handle:
 * - Stablecoin trades (fetched in Stage 3 to capture de-peg events)
 * - Crypto-crypto swaps (handled by Pass N+2 after fetching market prices)
 *
 * Examples:
 * - Buy 1 BTC with 50,000 USD: BTC = 50,000 USD/BTC
 * - Buy 100 XLM with 50 CAD: CAD = 1 CAD/CAD, XLM = 0.5 CAD/XLM
 *   (Then Stage 1 converts: 1 CAD → 0.75 USD, 0.5 CAD → 0.375 USD)
 */
export function calculatePriceFromTrade(
  movements: TradeMovements
): { assetSymbol: string; priceAtTxTime: PriceAtTxTime }[] {
  const { inflow, outflow, timestamp } = movements;

  const inflowCurrency = Currency.create(inflow.assetSymbol);
  const outflowCurrency = Currency.create(outflow.assetSymbol);

  const inflowIsUSD = inflowCurrency.toString() === 'USD';
  const outflowIsUSD = outflowCurrency.toString() === 'USD';
  const inflowIsFiat = inflowCurrency.isFiat();
  const outflowIsFiat = outflowCurrency.isFiat();

  const results: { assetSymbol: string; priceAtTxTime: PriceAtTxTime }[] = [];

  // Case 1: USD trades (highest priority - most authoritative)
  if (inflowIsUSD || outflowIsUSD) {
    // Outflow is USD - calculate price of inflow in USD + stamp USD identity price
    if (outflowIsUSD && !inflowIsUSD) {
      const price = parseDecimal(outflow.grossAmount.toFixed()).dividedBy(parseDecimal(inflow.grossAmount.toFixed()));

      results.push(
        {
          assetSymbol: inflow.assetSymbol,
          priceAtTxTime: {
            price: { amount: price, currency: outflowCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(timestamp),
            granularity: 'exact',
          },
        },
        {
          assetSymbol: outflow.assetSymbol, // USD
          priceAtTxTime: {
            price: { amount: parseDecimal('1'), currency: outflowCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(timestamp),
            granularity: 'exact',
          },
        }
      );
    }

    // Inflow is USD - calculate price of outflow in USD + stamp USD identity price
    if (inflowIsUSD && !outflowIsUSD) {
      const price = parseDecimal(inflow.grossAmount.toFixed()).dividedBy(parseDecimal(outflow.grossAmount.toFixed()));

      results.push(
        {
          assetSymbol: outflow.assetSymbol,
          priceAtTxTime: {
            price: { amount: price, currency: inflowCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(timestamp),
            granularity: 'exact',
          },
        },
        {
          assetSymbol: inflow.assetSymbol, // USD
          priceAtTxTime: {
            price: { amount: parseDecimal('1'), currency: inflowCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(timestamp),
            granularity: 'exact',
          },
        }
      );
    }

    return results;
  }

  // Case 2: Non-USD fiat trades (CAD, EUR, GBP, etc.)
  // One side must be fiat, other must be crypto
  // Use 'fiat-execution-tentative' (priority 0) so Stage 3 providers can overwrite if normalization fails
  // Stage 1 will upgrade to 'derived-ratio' (priority 2) upon successful USD normalization
  if (inflowIsFiat && !outflowIsFiat) {
    // Fiat inflow + crypto outflow (e.g., sell BTC for 50,000 CAD)
    // Assign: CAD = 1 CAD/CAD, BTC = 50,000/1 = 50,000 CAD/BTC
    const fiatPrice = parseDecimal('1'); // Identity price for fiat
    const cryptoPrice = parseDecimal(inflow.grossAmount.toFixed()).dividedBy(
      parseDecimal(outflow.grossAmount.toFixed())
    );

    results.push(
      {
        assetSymbol: inflow.assetSymbol,
        priceAtTxTime: {
          price: { amount: fiatPrice, currency: inflowCurrency },
          source: 'fiat-execution-tentative',
          fetchedAt: new Date(timestamp),
          granularity: 'exact',
        },
      },
      {
        assetSymbol: outflow.assetSymbol,
        priceAtTxTime: {
          price: { amount: cryptoPrice, currency: inflowCurrency },
          source: 'fiat-execution-tentative',
          fetchedAt: new Date(timestamp),
          granularity: 'exact',
        },
      }
    );

    return results;
  }

  if (outflowIsFiat && !inflowIsFiat) {
    // Fiat outflow + crypto inflow (e.g., buy 100 XLM with 50 CAD)
    // Assign: CAD = 1 CAD/CAD, XLM = 50/100 = 0.5 CAD/XLM
    const fiatPrice = parseDecimal('1'); // Identity price for fiat
    const cryptoPrice = parseDecimal(outflow.grossAmount.toFixed()).dividedBy(
      parseDecimal(inflow.grossAmount.toFixed())
    );

    results.push(
      {
        assetSymbol: outflow.assetSymbol,
        priceAtTxTime: {
          price: { amount: fiatPrice, currency: outflowCurrency },
          source: 'fiat-execution-tentative',
          fetchedAt: new Date(timestamp),
          granularity: 'exact',
        },
      },
      {
        assetSymbol: inflow.assetSymbol,
        priceAtTxTime: {
          price: { amount: cryptoPrice, currency: outflowCurrency },
          source: 'fiat-execution-tentative',
          fetchedAt: new Date(timestamp),
          granularity: 'exact',
        },
      }
    );

    return results;
  }

  // Case 3: Neither side is fiat - can't derive execution price
  // This includes:
  // - Stablecoin trades (USDC, USDT, DAI) - fetch in Stage 3
  // - Crypto-crypto swaps (BTC/ETH) - handle in Pass N+2
  return results;
}

/**
 * Stamp identity prices on fiat movements that don't have prices yet
 * Handles single-leg fiat movements (deposits, withdrawals, fees) that don't go through trade pricing
 *
 * Examples:
 * - CAD deposit: 1 CAD = 1 CAD (tentative, will be normalized to USD)
 * - USD withdrawal: 1 USD = 1 USD (final price, no normalization needed)
 * - EUR fee: 1 EUR = 1 EUR (tentative, will be normalized to USD)
 */
export function stampFiatIdentityPrices(
  movements: AssetMovement[],
  timestamp: number
): { assetSymbol: string; priceAtTxTime: PriceAtTxTime }[] {
  const results: { assetSymbol: string; priceAtTxTime: PriceAtTxTime }[] = [];

  for (const movement of movements) {
    // Skip if already has price
    if (movement.priceAtTxTime) {
      continue;
    }

    const currency = Currency.create(movement.assetSymbol);

    // Only stamp prices on fiat currencies
    if (!currency.isFiat()) {
      continue;
    }

    const isUSD = currency.toString() === 'USD';

    results.push({
      assetSymbol: movement.assetSymbol,
      priceAtTxTime: {
        price: { amount: parseDecimal('1'), currency },
        // USD gets 'exchange-execution' (final), non-USD gets 'fiat-execution-tentative' (will be normalized)
        source: isUSD ? 'exchange-execution' : 'fiat-execution-tentative',
        fetchedAt: new Date(timestamp),
        granularity: 'exact',
      },
    });
  }

  return results;
}
