import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  calculatePriceFromTrade,
  extractTradeMovements,
  findClosestPrice,
  inferPriceFromTrade,
} from '../price-calculation-utils.ts';

describe('extractTradeMovements', () => {
  it('should extract simple trade pattern (1 inflow + 1 outflow)', () => {
    const inflows: AssetMovement[] = [
      {
        asset: 'BTC',
        amount: new Decimal('1'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: 'USDT',
        amount: new Decimal('50000'),
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
        amount: new Decimal('1'),
      },
      {
        asset: 'ETH',
        amount: new Decimal('10'),
      },
    ];

    const outflows: AssetMovement[] = [
      {
        asset: 'USDT',
        amount: new Decimal('50000'),
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
        amount: new Decimal('1'),
      },
      outflow: {
        asset: 'USDT',
        amount: new Decimal('50000'),
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
        amount: new Decimal('6000'),
      },
      outflow: {
        asset: 'ETH',
        amount: new Decimal('2'),
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
        amount: new Decimal('999.5'),
      },
      outflow: {
        asset: 'USDT',
        amount: new Decimal('1000'),
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
        amount: new Decimal('20'),
      },
      outflow: {
        asset: 'BTC',
        amount: new Decimal('1'),
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
        amount: new Decimal('0.5'),
      },
      outflow: {
        asset: 'USDT',
        amount: new Decimal('25000'),
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

describe('findClosestPrice', () => {
  it('should find closest price within time window', () => {
    const priceIndex = new Map<string, PriceAtTxTime[]>();

    const baseTimestamp = 1234567890000;
    priceIndex.set('BTC', [
      {
        price: { amount: new Decimal('48000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(baseTimestamp),
        granularity: 'exact',
      },
      {
        price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(baseTimestamp + 300000), // +5 min
        granularity: 'exact',
      },
      {
        price: { amount: new Decimal('52000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(baseTimestamp + 600000), // +10 min
        granularity: 'exact',
      },
    ]);

    const targetTimestamp = baseTimestamp + 350000; // +5:50 min
    const maxTimeDelta = 600000; // 10 min

    const result = findClosestPrice('BTC', targetTimestamp, priceIndex, maxTimeDelta);

    expect(result).toBeDefined();
    expect(result!.price.amount.toString()).toBe('50000');
    expect(result!.source).toBe('derived-history');
  });

  it('should return undefined if no price within time window', () => {
    const priceIndex = new Map<string, PriceAtTxTime[]>();

    const baseTimestamp = 1234567890000;
    priceIndex.set('BTC', [
      {
        price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(baseTimestamp),
        granularity: 'exact',
      },
    ]);

    const targetTimestamp = baseTimestamp + 7200000; // +2 hours
    const maxTimeDelta = 3600000; // 1 hour

    const result = findClosestPrice('BTC', targetTimestamp, priceIndex, maxTimeDelta);

    expect(result).toBeUndefined();
  });

  it('should return undefined for unknown asset', () => {
    const priceIndex = new Map<string, PriceAtTxTime[]>();

    priceIndex.set('BTC', [
      {
        price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(1234567890000),
        granularity: 'exact',
      },
    ]);

    const result = findClosestPrice('ETH', 1234567890000, priceIndex, 3600000);

    expect(result).toBeUndefined();
  });
});

describe('inferPriceFromTrade', () => {
  it('should infer outflow price when inflow price is known', () => {
    // Swap 1 BTC for 20 ETH
    // We know: BTC = $50,000
    // Calculate: ETH = $2,500
    const trade = {
      inflow: {
        asset: 'ETH',
        amount: new Decimal('20'),
      },
      outflow: {
        asset: 'BTC',
        amount: new Decimal('1'),
      },
      timestamp: 1234567890000,
    };

    const priceIndex = new Map<string, PriceAtTxTime[]>();
    priceIndex.set('BTC', [
      {
        price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(1234567890000),
        granularity: 'exact',
      },
    ]);

    const result = inferPriceFromTrade(trade, priceIndex, 3600000);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    expect(result[0]!.asset).toBe('ETH');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('2500');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USDT');
    expect(result[0]!.priceAtTxTime.source).toBe('derived-trade');
  });

  it('should infer inflow price when outflow price is known', () => {
    // Swap 10 ETH for 500 SOL
    // We know: ETH = $2,500
    // Calculate: SOL = $50
    const trade = {
      inflow: {
        asset: 'SOL',
        amount: new Decimal('500'),
      },
      outflow: {
        asset: 'ETH',
        amount: new Decimal('10'),
      },
      timestamp: 1234567890000,
    };

    const priceIndex = new Map<string, PriceAtTxTime[]>();
    priceIndex.set('ETH', [
      {
        price: { amount: new Decimal('2500'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(1234567890000),
        granularity: 'exact',
      },
    ]);

    const result = inferPriceFromTrade(trade, priceIndex, 3600000);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('SOL');
    expect(result[0]!.priceAtTxTime.price.amount.toFixed()).toBe('50');
    expect(result[0]!.priceAtTxTime.price.currency.toString()).toBe('USDT');
    expect(result[0]!.priceAtTxTime.source).toBe('derived-trade');
  });

  it('should return empty array if neither price is known', () => {
    const trade = {
      inflow: {
        asset: 'ETH',
        amount: new Decimal('20'),
      },
      outflow: {
        asset: 'BTC',
        amount: new Decimal('1'),
      },
      timestamp: 1234567890000,
    };

    const priceIndex = new Map<string, PriceAtTxTime[]>();

    const result = inferPriceFromTrade(trade, priceIndex, 3600000);

    expect(result).toHaveLength(0);
  });

  it('should return empty array if both movements already have prices', () => {
    const existingPrice: PriceAtTxTime = {
      price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
      source: 'exchange-execution',
      fetchedAt: new Date(1234567890000),
      granularity: 'exact',
    };

    const trade = {
      inflow: {
        asset: 'ETH',
        amount: new Decimal('20'),
        priceAtTxTime: existingPrice,
      },
      outflow: {
        asset: 'BTC',
        amount: new Decimal('1'),
        priceAtTxTime: existingPrice,
      },
      timestamp: 1234567890000,
    };

    const priceIndex = new Map<string, PriceAtTxTime[]>();
    priceIndex.set('BTC', [existingPrice]);

    const result = inferPriceFromTrade(trade, priceIndex, 3600000);

    expect(result).toHaveLength(0);
  });

  it('should not use price if outside time window', () => {
    const trade = {
      inflow: {
        asset: 'ETH',
        amount: new Decimal('20'),
      },
      outflow: {
        asset: 'BTC',
        amount: new Decimal('1'),
      },
      timestamp: 1234567890000,
    };

    const priceIndex = new Map<string, PriceAtTxTime[]>();
    priceIndex.set('BTC', [
      {
        price: { amount: new Decimal('50000'), currency: Currency.create('USDT') },
        source: 'exchange-execution',
        fetchedAt: new Date(1234567890000 - 7200000), // -2 hours
        granularity: 'exact',
      },
    ]);

    const maxTimeDelta = 3600000; // 1 hour
    const result = inferPriceFromTrade(trade, priceIndex, maxTimeDelta);

    expect(result).toHaveLength(0);
  });
});
