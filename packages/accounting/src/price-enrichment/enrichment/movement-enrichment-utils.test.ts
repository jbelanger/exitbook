/**
 * Tests for movement enrichment utilities
 *
 * These tests verify the price priority rules:
 * 1. exchange-execution (highest priority - never overwrite)
 * 2. derived-ratio, link-propagated (can overwrite provider prices)
 * 3. provider prices (lowest priority)
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import type { AssetMovementDraft, PriceAtTxTime } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { enrichMovementsWithPrices } from './movement-enrichment-utils.js';

/**
 * Helper to test single-movement price enrichment through the public API.
 * These tests verify the priority rules exercised via enrichMovementsWithPrices.
 */
describe('price priority rules (via enrichMovementsWithPrices)', () => {
  const createMovement = (price?: PriceAtTxTime): AssetMovementDraft => ({
    assetId: 'test:btc',
    assetSymbol: 'BTC' as Currency,
    grossAmount: parseDecimal('1.0'),
    priceAtTxTime: price,
  });

  const createPrice = (source: string, amount = '50000'): PriceAtTxTime => ({
    price: {
      amount: parseDecimal(amount),
      currency: 'USD' as Currency,
    },
    source,
    fetchedAt: new Date(),
    granularity: 'hour' as const,
  });

  function enrichSingle(movement: AssetMovementDraft, newPrice: PriceAtTxTime): AssetMovementDraft {
    return enrichMovementsWithPrices([movement], new Map([['BTC', newPrice]]))[0]!;
  }

  it('should add price when movement has no price', () => {
    const result = enrichSingle(createMovement(), createPrice('coingecko'));

    expect(result.priceAtTxTime).toBeDefined();
    expect(result.priceAtTxTime?.source).toBe('coingecko');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite exchange-execution price (highest priority)', () => {
    const result = enrichSingle(
      createMovement(createPrice('exchange-execution')),
      createPrice('derived-ratio', '48000')
    );

    expect(result.priceAtTxTime?.source).toBe('exchange-execution');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should overwrite provider price with derived-ratio', () => {
    const result = enrichSingle(createMovement(createPrice('coingecko')), createPrice('derived-ratio', '48000'));

    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('48000');
  });

  it('should overwrite provider price with link-propagated', () => {
    const result = enrichSingle(createMovement(createPrice('cryptocompare')), createPrice('link-propagated', '51000'));

    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should NOT overwrite provider price with another provider price', () => {
    const result = enrichSingle(createMovement(createPrice('coingecko')), createPrice('binance', '49000'));

    expect(result.priceAtTxTime?.source).toBe('coingecko');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite derived-ratio with provider price', () => {
    const result = enrichSingle(createMovement(createPrice('derived-ratio')), createPrice('coingecko', '49000'));

    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should NOT overwrite link-propagated with provider price', () => {
    const result = enrichSingle(createMovement(createPrice('link-propagated')), createPrice('binance', '49000'));

    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
  });

  it('should allow derived-ratio to overwrite itself (re-enrichment)', () => {
    const result = enrichSingle(
      createMovement(createPrice('derived-ratio', '50000')),
      createPrice('derived-ratio', '51000')
    );

    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should allow link-propagated to overwrite itself (re-enrichment)', () => {
    const result = enrichSingle(
      createMovement(createPrice('link-propagated', '50000')),
      createPrice('link-propagated', '52000')
    );

    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('52000');
  });

  it('should allow derived-ratio to overwrite link-propagated (same priority)', () => {
    const result = enrichSingle(
      createMovement(createPrice('link-propagated', '50000')),
      createPrice('derived-ratio', '51000')
    );

    expect(result.priceAtTxTime?.source).toBe('derived-ratio');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('51000');
  });

  it('should allow link-propagated to overwrite derived-ratio (same priority)', () => {
    const result = enrichSingle(
      createMovement(createPrice('derived-ratio', '50000')),
      createPrice('link-propagated', '52000')
    );

    expect(result.priceAtTxTime?.source).toBe('link-propagated');
    expect(result.priceAtTxTime?.price.amount.toFixed()).toBe('52000');
  });
});

describe('enrichMovementsWithPrices', () => {
  it('should enrich multiple movements using price map', () => {
    const movements: AssetMovementDraft[] = [
      { assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.0') },
      { assetId: 'test:eth', assetSymbol: 'ETH' as Currency, grossAmount: parseDecimal('10.0') },
      { assetId: 'test:sol', assetSymbol: 'SOL' as Currency, grossAmount: parseDecimal('100.0') },
    ];

    const pricesMap = new Map<string, PriceAtTxTime>([
      [
        'BTC',
        {
          price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
          source: 'coingecko',
          fetchedAt: new Date(),
          granularity: 'hour' as const,
        },
      ],
      [
        'ETH',
        {
          price: { amount: parseDecimal('3000'), currency: 'USD' as Currency },
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
    const movements: AssetMovementDraft[] = [
      {
        assetSymbol: 'BTC' as Currency,
        assetId: 'test:btc',
        grossAmount: parseDecimal('1.0'),
        priceAtTxTime: {
          price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
          source: 'exchange-execution',
          fetchedAt: new Date(),
          granularity: 'exact' as const,
        },
      },
      {
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        grossAmount: parseDecimal('10.0'),
        priceAtTxTime: {
          price: { amount: parseDecimal('3000'), currency: 'USD' as Currency },
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
          price: { amount: parseDecimal('48000'), currency: 'USD' as Currency },
          source: 'derived-ratio', // Shouldn't overwrite exchange-execution
          fetchedAt: new Date(),
          granularity: 'exact' as const,
        },
      ],
      [
        'ETH',
        {
          price: { amount: parseDecimal('3100'), currency: 'USD' as Currency },
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
