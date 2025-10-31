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
  it('should calculate price for BTC-USDT buy (crypto-stable)', () => {
    // Buy 1 BTC with 50,000 USDT
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

    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USDT');
    expect(result[0]!.priceAtTxTime.source).toBe('exchange-execution');
    expect(result[0]!.priceAtTxTime.granularity).toBe('exact');
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

  it('should calculate prices for both sides in stablecoin swap', () => {
    // Swap 1000 USDT for 999.5 USDC
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

    expect(result).toHaveLength(2);

    // USDC price in USDT
    expect(result[0]!.asset).toBe('USDC');
    // 1000 / 999.5 = 1.0005002501250625...
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toMatch(/^1\.00050025012506253126563281/);
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USDT');

    // USDT price in USDC
    expect(result[1]!.asset).toBe('USDT');
    expect(result[1]!.priceAtTxTime.price.amount.toFixed()).toBe('0.9995');
    expect(result[1]!.priceAtTxTime.price.currency.toString()).toBe('USDC');
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

  it('should handle fractional amounts correctly', () => {
    // Buy 0.5 BTC with 25,000 USDT
    const trade = {
      inflow: {
        asset: 'BTC',
        amount: parseDecimal('0.5'),
      },
      outflow: {
        asset: 'USDT',
        amount: parseDecimal('25000'),
      },
      timestamp: 1234567890000,
    };

    const result = calculatePriceFromTrade(trade);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50000');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USDT');
  });
});
