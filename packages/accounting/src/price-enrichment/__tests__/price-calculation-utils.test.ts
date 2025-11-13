import { Currency } from '@exitbook/core';
import type { AssetMovement } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { calculatePriceFromTrade, extractTradeMovements } from '../price-calculation-utils.js';

describe('extractTradeMovements', () => {
  it('should extract simple trade pattern (1 inflow + 1 outflow)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: Currency.create('USDT'),
        grossAmount: parseDecimal('50000'),
      },
    ];

    const timestamp = 1234567890000;
    const result = extractTradeMovements(inflows, outflows, timestamp);

    expect(result).toEqual({
      inflow: inflows[0],
      outflow: outflows[0],
      timestamp,
    });
  });

  it('should return undefined for complex patterns', () => {
    const inflows: AssetMovement[] = [
      {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      {
        asset: Currency.create('ETH'),
        grossAmount: parseDecimal('10'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: Currency.create('USDT'),
        grossAmount: parseDecimal('50000'),
      },
    ];

    const timestamp = 1234567890000;
    const result = extractTradeMovements(inflows, outflows, timestamp);

    expect(result).toBeUndefined();
  });
});

describe('calculatePriceFromTrade', () => {
  it('should NOT derive price for BTC-USDT buy (stablecoin - use Stage 3 instead)', () => {
    // Buy 1 BTC with 50,000 USDT
    // USDT is a stablecoin, not actual USD
    // Stablecoins are fetched in Stage 3 to capture de-peg events
    const trade = {
      inflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      outflow: {
        asset: Currency.create('USDT'),
        grossAmount: parseDecimal('50000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return empty - stablecoins are NOT treated as USD
    expect(result).toHaveLength(0);
  });

  it('should calculate price for ETH-USD sell (crypto-fiat)', () => {
    // Sell 2 ETH for 6,000 USD
    const trade = {
      inflow: {
        asset: Currency.create('USD'),
        grossAmount: parseDecimal('6000'),
      },
      outflow: {
        asset: Currency.create('ETH'),
        grossAmount: parseDecimal('2'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toBe('ETH');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('3000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
    expect(result[0]!.priceAtTxTime.source).toBe('exchange-execution');
    // Also stamps USD identity price
    expect(result[1]!.asset).toBe('USD');
    expect(result[1]!.priceAtTxTime.price.amount.toFixed()).toBe('1');
    expect(result[1]!.priceAtTxTime.source).toBe('exchange-execution');
  });

  it('should NOT derive prices for stablecoin swap (use Stage 3 instead)', () => {
    // Swap 1000 USDT for 999.5 USDC
    // Stablecoins are NOT treated as USD - they need actual historical prices
    // from Stage 3 to capture de-peg events
    const trade = {
      inflow: {
        asset: Currency.create('USDC'),
        grossAmount: parseDecimal('999.5'),
      },
      outflow: {
        asset: Currency.create('USDT'),
        grossAmount: parseDecimal('1000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return empty - stablecoins are NOT treated as USD
    expect(result).toHaveLength(0);
  });

  it('should return empty array for crypto-crypto trade (no fiat/stable)', () => {
    // Swap 1 BTC for 20 ETH (no fiat/stablecoin)
    const trade = {
      inflow: {
        asset: Currency.create('ETH'),
        grossAmount: parseDecimal('20'),
      },
      outflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(0);
  });

  it('should handle fractional amounts correctly for USD trades', () => {
    // Buy 0.5 BTC with 25,000 USD (actual USD, not stablecoin)
    const trade = {
      inflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('0.5'),
      },
      outflow: {
        asset: Currency.create('USD'),
        grossAmount: parseDecimal('25000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
    // Also stamps USD identity price
    expect(result[1]!.asset).toBe('USD');
    expect(result[1]!.priceAtTxTime.price.amount.toFixed()).toBe('1');
    expect(result[1]!.priceAtTxTime.source).toBe('exchange-execution');
  });

  it('should derive price for EUR trade in native currency (then normalized to USD in Stage 1)', () => {
    // Buy 1 BTC with 40,000 EUR
    // Pass 0: Derive prices in EUR with 'fiat-execution-tentative' (priority 0)
    // Stage 1: Normalize to USD and upgrade to 'derived-ratio' (priority 2)
    // If Stage 1 fails, Stage 3 providers (priority 1) can overwrite
    const trade = {
      inflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      outflow: {
        asset: Currency.create('EUR'),
        grossAmount: parseDecimal('40000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return 2 prices: EUR (identity) and BTC (in EUR)
    expect(result).toHaveLength(2);

    // EUR gets identity price (1 EUR = 1 EUR) with tentative source
    const eurPrice = result.find((r) => r.asset === 'EUR');
    expect(eurPrice).toBeDefined();
    expect(eurPrice!.priceAtTxTime.price.amount.toFixed()).toBe('1');
    expect(eurPrice!.priceAtTxTime.price.currency.toString()).toBe('EUR');
    expect(eurPrice!.priceAtTxTime.source).toBe('fiat-execution-tentative');

    // BTC gets price in EUR (40,000 EUR / 1 BTC) with tentative source
    const btcPrice = result.find((r) => r.asset === 'BTC');
    expect(btcPrice).toBeDefined();
    expect(btcPrice!.priceAtTxTime.price.amount.toFixed()).toBe('40000');
    expect(btcPrice!.priceAtTxTime.price.currency.toString()).toBe('EUR');
    expect(btcPrice!.priceAtTxTime.source).toBe('fiat-execution-tentative');
  });

  it('should derive price for CAD trade in native currency (then normalized to USD in Stage 1)', () => {
    // Buy 1 BTC with 65,000 CAD
    // Pass 0: Derive prices in CAD with 'fiat-execution-tentative' (priority 0)
    // Stage 1: Normalize to USD and upgrade to 'derived-ratio' (priority 2)
    // If Stage 1 fails, Stage 3 providers (priority 1) can overwrite
    const trade = {
      inflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      outflow: {
        asset: Currency.create('CAD'),
        grossAmount: parseDecimal('65000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return 2 prices: CAD (identity) and BTC (in CAD)
    expect(result).toHaveLength(2);

    // CAD gets identity price (1 CAD = 1 CAD) with tentative source
    const cadPrice = result.find((r) => r.asset === 'CAD');
    expect(cadPrice).toBeDefined();
    expect(cadPrice!.priceAtTxTime.price.amount.toFixed()).toBe('1');
    expect(cadPrice!.priceAtTxTime.price.currency.toString()).toBe('CAD');
    expect(cadPrice!.priceAtTxTime.source).toBe('fiat-execution-tentative');

    // BTC gets price in CAD (65,000 CAD / 1 BTC) with tentative source
    const btcPrice = result.find((r) => r.asset === 'BTC');
    expect(btcPrice).toBeDefined();
    expect(btcPrice!.priceAtTxTime.price.amount.toFixed()).toBe('65000');
    expect(btcPrice!.priceAtTxTime.price.currency.toString()).toBe('CAD');
    expect(btcPrice!.priceAtTxTime.source).toBe('fiat-execution-tentative');
  });

  it('should calculate price for USD buy trade (actual USD only)', () => {
    // Buy 1 BTC with 50,000 USD (actual USD)
    const trade = {
      inflow: {
        asset: Currency.create('BTC'),
        grossAmount: parseDecimal('1'),
      },
      outflow: {
        asset: Currency.create('USD'),
        grossAmount: parseDecimal('50000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
    expect(result[0]!.priceAtTxTime.source).toBe('exchange-execution');
    expect(result[0]!.priceAtTxTime.granularity).toBe('exact');
    // Also stamps USD identity price
    expect(result[1]!.asset).toBe('USD');
    expect(result[1]!.priceAtTxTime.price.amount.toFixed()).toBe('1');
    expect(result[1]!.priceAtTxTime.source).toBe('exchange-execution');
  });
});
