import { type Currency, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../matching/matching-config.js';
import { createLinkableMovement } from '../shared/test-utils.js';

import { AmountTimingStrategy } from './amount-timing-strategy.js';

describe('AmountTimingStrategy', () => {
  it('has name "amount-timing"', () => {
    const strategy = new AmountTimingStrategy();
    expect(strategy.name).toBe('amount-timing');
  });

  it('returns empty result when no sources or targets are provided', () => {
    const strategy = new AmountTimingStrategy();
    const result = assertOk(strategy.execute([], [], buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
    expect(result.consumedCandidateIds.size).toBe(0);
  });

  it('returns empty result when no matches are found', () => {
    const strategy = new AmountTimingStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 100,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 200,
        sourceName: 'coinbase',
        sourceType: 'exchange',
        assetId: 'exchange:coinbase:eth',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('10.0'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:30:00Z'),
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
    expect(result.consumedCandidateIds.size).toBe(0);
  });

  it('produces links when source and target match on asset, amount, and timing', () => {
    const strategy = new AmountTimingStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 100,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        toAddress: '0xabc',
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 200,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0.999'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:30:00Z'),
        toAddress: '0xabc',
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links.length).toBeGreaterThanOrEqual(1);
    expect(result.consumedCandidateIds.has(1)).toBe(true);
    expect(result.consumedCandidateIds.has(2)).toBe(true);

    const link = result.links[0]!;
    expect(link.sourceTransactionId).toBe(100);
    expect(link.targetTransactionId).toBe(200);
    expect(link.assetSymbol).toBe('BTC');
    expect(link.linkType).toBe('exchange_to_blockchain');
  });

  it('does not match same-source movements', () => {
    const strategy = new AmountTimingStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 100,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 200,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:30:00Z'),
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
  });

  it('does not match movements outside timing window', () => {
    const strategy = new AmountTimingStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 100,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        movementFingerprint: 'movement:test:100:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 200,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        direction: 'in',
        // 72 hours later — beyond 48h window
        timestamp: new Date('2024-01-04T12:00:00Z'),
        movementFingerprint: 'movement:test:200:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
  });
});
