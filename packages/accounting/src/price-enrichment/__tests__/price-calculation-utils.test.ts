import type { AssetMovement } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { calculatePriceFromTrade, extractTradeMovements } from '../price-calculation-utils.ts';

describe('extractTradeMovements', () => {
  it('should extract simple trade pattern (1 inflow + 1 outflow)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: 'USDT',
        amount: parseDecimal('50000'),
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
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
      {
        asset: 'ETH',
        amount: parseDecimal('10'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: 'USDT',
        amount: parseDecimal('50000'),
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
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
      outflow: {
        asset: 'USDT',
        amount: parseDecimal('50000'),
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
        asset: 'USD',
        amount: parseDecimal('6000'),
      },
      outflow: {
        asset: 'ETH',
        amount: parseDecimal('2'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('ETH');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('3000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
    expect(result[0]!.priceAtTxTime.source).toBe('exchange-execution');
  });

  it('should NOT derive prices for stablecoin swap (use Stage 3 instead)', () => {
    // Swap 1000 USDT for 999.5 USDC
    // Stablecoins are NOT treated as USD - they need actual historical prices
    // from Stage 3 to capture de-peg events
    const trade = {
      inflow: {
        asset: 'USDC',
        amount: parseDecimal('999.5'),
      },
      outflow: {
        asset: 'USDT',
        amount: parseDecimal('1000'),
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
        asset: 'ETH',
        amount: parseDecimal('20'),
      },
      outflow: {
        asset: 'BTC',
        amount: parseDecimal('1'),
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
        asset: 'BTC',
        amount: parseDecimal('0.5'),
      },
      outflow: {
        asset: 'USD',
        amount: parseDecimal('25000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
  });

  it('should NOT derive price for EUR trade (normalized separately in Stage 1)', () => {
    // Buy 1 BTC with 40,000 EUR
    // EUR trades are normalized to USD in Stage 1 via FX providers
    const trade = {
      inflow: {
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
      outflow: {
        asset: 'EUR',
        amount: parseDecimal('40000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return empty - EUR is normalized separately
    expect(result).toHaveLength(0);
  });

  it('should NOT derive price for CAD trade (normalized separately in Stage 1)', () => {
    // Buy 1 BTC with 65,000 CAD
    // CAD trades are normalized to USD in Stage 1 via FX providers
    const trade = {
      inflow: {
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
      outflow: {
        asset: 'CAD',
        amount: parseDecimal('65000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    // Should return empty - CAD is normalized separately
    expect(result).toHaveLength(0);
  });

  it('should calculate price for USD buy trade (actual USD only)', () => {
    // Buy 1 BTC with 50,000 USD (actual USD)
    const trade = {
      inflow: {
        asset: 'BTC',
        amount: parseDecimal('1'),
      },
      outflow: {
        asset: 'USD',
        amount: parseDecimal('50000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USD');
    expect(result[0]!.priceAtTxTime.source).toBe('exchange-execution');
    expect(result[0]!.priceAtTxTime.granularity).toBe('exact');
  });
});
