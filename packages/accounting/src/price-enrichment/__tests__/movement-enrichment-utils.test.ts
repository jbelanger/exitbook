/**
 * Tests for movement enrichment utilities
 *
 * These tests verify the price priority rules:
 * 1. exchange-execution (highest priority - never overwrite)
 * 2. derived-ratio, link-propagated (can overwrite provider prices)
 * 3. provider prices (lowest priority)
 */

import { Currency, parseDecimal } from '@exitbook/core';
import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { enrichMovementWithPrice, enrichMovementsWithPrices } from '../movement-enrichment-utils.ts';

describe('enrichMovementWithPrice', () => {
  const createMovement = (price?: PriceAtTxTime): AssetMovement => ({
    asset: 'BTC',
    amount: parseDecimal('1.0'),
    priceAtTxTime: price,
  });

  const createPrice = (source: string, amount = '50000'): PriceAtTxTime => ({
    price: {
      amount: parseDecimal(amount),
      currency: Currency.create('USD'),
    },
    source,
    fetchedAt: new Date(),
    granularity: 'hour' as const,
  });

  it('should add price when movement has no price', () => {
    const movement = createMovement();
    const newPrice = createPrice('coingecko');

    const result = enrichMovementWithPrice(movement, newPrice);

    expect(result.priceAtTxTime).toBeDefined();
    expect(result.priceAtTxTime?.source).toBe('coingecko');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite exchange-execution price (highest priority)', () => {
    const movement = createMovement(createPrice('exchange-execution'));
    const newPrice = createPrice('derived-ratio', '48000');

    const result = enrichMovementWithPrice(movement, newPrice);

    expect(result.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should overwrite provider price with derived-ratio', () => {
    const movement = createMovement(createPrice('coingecko'));
    const newPrice = createPrice('derived-ratio', '48000');

    const result = enrichMovementWithPrice(movement, newPrice);

    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('48000');
  });

  it('should overwrite provider price with link-propagated', () => {
    const movement = createMovement(createPrice('cryptocompare'));
    const newPrice = createPrice('link-propagated', '51000');

    const result = enrichMovementWithPrice(movement, newPrice);

    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should NOT overwrite provider price with another provider price', () => {
    const movement = createMovement(createPrice('coingecko'));
    const newPrice = createPrice('binance', '49000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // Keep original provider price (same priority level)
    expect(result.priceAtTxTime?.source).toBe('coingecko');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite derived-ratio with provider price', () => {
    const movement = createMovement(createPrice('derived-ratio'));
    const newPrice = createPrice('coingecko', '49000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // Keep higher priority price
    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite link-propagated with provider price', () => {
    const movement = createMovement(createPrice('link-propagated'));
    const newPrice = createPrice('binance', '49000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // Keep higher priority price
    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should allow derived-ratio to overwrite itself (re-enrichment)', () => {
    const movement = createMovement(createPrice('derived-ratio', '50000'));
    const newPrice = createPrice('derived-ratio', '51000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // New derived-ratio should overwrite old derived-ratio (enables re-running enrichment)
    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should allow link-propagated to overwrite itself (re-enrichment)', () => {
    const movement = createMovement(createPrice('link-propagated', '50000'));
    const newPrice = createPrice('link-propagated', '52000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // New link-propagated should overwrite old link-propagated (enables re-running enrichment)
    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('52000');
  });

  it('should allow derived-ratio to overwrite link-propagated (same priority)', () => {
    const movement = createMovement(createPrice('link-propagated', '50000'));
    const newPrice = createPrice('derived-ratio', '51000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // derived-ratio should overwrite link-propagated (both priority 2)
    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should allow link-propagated to overwrite derived-ratio (same priority)', () => {
    const movement = createMovement(createPrice('derived-ratio', '50000'));
    const newPrice = createPrice('link-propagated', '52000');

    const result = enrichMovementWithPrice(movement, newPrice);

    // link-propagated should overwrite derived-ratio (both priority 2)
    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('52000');
  });
});

describe('enrichMovementsWithPrices', () => {
  it('should enrich multiple movements using price map', () => {
    const movements: AssetMovement[] = [
      { asset: 'BTC', amount: parseDecimal('1.0') },
      { asset: 'ETH', amount: parseDecimal('10.0') },
      { asset: 'SOL', amount: parseDecimal('100.0') },
    ];

    const pricesMap = new Map<string, PriceAtTxTime>([
      [
        'BTC',
        {
          price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
          source: 'coingecko',
          fetchedAt: new Date(),
          granularity: 'hour' as const,
        },
      ],
      [
        'ETH',
        {
          price: { amount: parseDecimal('3000'), currency: Currency.create('USD') },
          source: 'binance',
          fetchedAt: new Date(),
          granularity: 'minute' as const,
        },
      ],
      // SOL intentionally missing
    ]);

    const enriched = enrichMovementsWithPrices(movements, pricesMap);

    expect(enriched[0]?.priceAtTxTime?.source).toBe('coingecko');
    expect(enriched[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
    expect(enriched[1]?.priceAtTxTime?.source).toBe('binance');
    expect(enriched[1]?.priceAtTxTime?.price.amount.toFixed()).toBe('3000');
    expect(enriched[2]?.priceAtTxTime).toBeUndefined(); // No price for SOL
  });

  it('should respect priority rules when enriching multiple movements', () => {
    const movements: AssetMovement[] = [
      {
        asset: 'BTC',
        amount: parseDecimal('1.0'),
        priceAtTxTime: {
          price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
          source: 'exchange-execution',
          fetchedAt: new Date(),
          granularity: 'exact' as const,
        },
      },
      {
        asset: 'ETH',
        amount: parseDecimal('10.0'),
        priceAtTxTime: {
          price: { amount: parseDecimal('3000'), currency: Currency.create('USD') },
          source: 'coingecko',
          fetchedAt: new Date(),
          granularity: 'hour' as const,
        },
      },
    ];

    const pricesMap = new Map<string, PriceAtTxTime>([
      [
        'BTC',
        {
          price: { amount: parseDecimal('48000'), currency: Currency.create('USD') },
          source: 'derived-ratio', // Shouldn't overwrite exchange-execution
          fetchedAt: new Date(),
          granularity: 'exact' as const,
        },
      ],
      [
        'ETH',
        {
          price: { amount: parseDecimal('3100'), currency: Currency.create('USD') },
          source: 'link-propagated', // Should overwrite coingecko
          fetchedAt: new Date(),
          granularity: 'exact' as const,
        },
      ],
    ]);

    const enriched = enrichMovementsWithPrices(movements, pricesMap);

    // BTC: exchange-execution should NOT be overwritten
    expect(enriched[0]?.priceAtTxTime?.source).toBe('exchange-execution');
    expect(enriched[0]?.priceAtTxTime?.price.amount.toFixed()).toBe('50000');

    // ETH: coingecko should be overwritten by link-propagated
    expect(enriched[1]?.priceAtTxTime?.source).toBe('link-propagated');
    expect(enriched[1]?.priceAtTxTime?.price.amount.toFixed()).toBe('3100');
  });
});
