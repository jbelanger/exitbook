import { type Currency, parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../matching/matching-config.js';
import { createLinkableMovement } from '../../shared/test-utils.js';
import { CounterpartyRoundtripStrategy } from '../counterparty-roundtrip-strategy.js';

describe('CounterpartyRoundtripStrategy', () => {
  it('confirms an exact same-counterparty return flow on the same blockchain', () => {
    const strategy = new CounterpartyRoundtripStrategy();
    const userAddress = 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm';
    const serviceAddress = '5hbEYpnexwWRMDyPS3ZxjCS9dfVjxHJQV6URZ7cJ6QcU';
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 1854,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165'),
        direction: 'out',
        timestamp: new Date('2026-03-13T00:24:54.000Z'),
        fromAddress: userAddress,
        toAddress: serviceAddress,
        movementFingerprint: 'movement:solana:1854:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 1803,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165'),
        direction: 'in',
        timestamp: new Date('2026-03-24T21:41:00.000Z'),
        fromAddress: serviceAddress,
        toAddress: userAddress,
        movementFingerprint: 'movement:solana:1803:inflow:0',
      }),
    ];

    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(1);
    expect([...result.value.consumedCandidateIds].sort((left, right) => left - right)).toEqual([1, 2]);

    const link = result.value.links[0]!;
    expect(link.status).toBe('confirmed');
    expect(link.linkType).toBe('blockchain_to_blockchain');
    expect(link.sourceTransactionId).toBe(1854);
    expect(link.targetTransactionId).toBe(1803);
    expect(link.confidenceScore.eq(parseDecimal('1'))).toBe(true);
    expect(link.metadata?.counterpartyRoundtrip).toBe(true);
  });

  it('skips matches when the return comes from a different counterparty', () => {
    const strategy = new CounterpartyRoundtripStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 1854,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165'),
        direction: 'out',
        timestamp: new Date('2026-03-13T00:24:54.000Z'),
        fromAddress: 'user-address',
        toAddress: 'service-a',
        movementFingerprint: 'movement:solana:1854:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 1803,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165'),
        direction: 'in',
        timestamp: new Date('2026-03-24T21:41:00.000Z'),
        fromAddress: 'service-b',
        toAddress: 'user-address',
        movementFingerprint: 'movement:solana:1803:inflow:0',
      }),
    ];

    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(0);
    expect(result.value.consumedCandidateIds.size).toBe(0);
  });

  it('skips matches outside the roundtrip timing window', () => {
    const strategy = new CounterpartyRoundtripStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 1830,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165.169516'),
        direction: 'out',
        timestamp: new Date('2026-03-24T21:45:36.000Z'),
        fromAddress: 'user-address',
        toAddress: 'service-a',
        movementFingerprint: 'movement:solana:1830:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 1805,
        accountId: 15,
        platformKey: 'solana',
        platformKind: 'blockchain',
        assetId: 'blockchain:solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        assetSymbol: 'USDT' as Currency,
        amount: parseDecimal('165.169516'),
        direction: 'in',
        timestamp: new Date('2026-05-24T21:45:36.000Z'),
        fromAddress: 'service-a',
        toAddress: 'user-address',
        movementFingerprint: 'movement:solana:1805:inflow:0',
      }),
    ];

    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(0);
    expect(result.value.consumedCandidateIds.size).toBe(0);
  });
});
