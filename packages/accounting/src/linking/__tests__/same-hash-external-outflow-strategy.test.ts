import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCHING_CONFIG } from '../matching-config.js';
import { SameHashExternalOutflowStrategy } from '../strategies/same-hash-external-outflow-strategy.js';

import { createCandidate } from './test-utils.js';

describe('SameHashExternalOutflowStrategy', () => {
  it('confirms a same-hash multi-input blockchain send into one exchange deposit using a single deduped fee', () => {
    const hash = 'f976ebbad12a363c826f83a9c02af63bcf1a5475dc688ee87e07d7061611b23c';
    const timestamp = new Date('2024-07-05T11:37:19.000Z');
    const targetTimestamp = new Date('2024-07-05T11:54:06.902Z');
    const toAddress = '3J11opeYh2dBkKXzsCPe6PybEMP729sX1M';

    const sources = [
      createCandidate({
        id: 1,
        transactionId: 407,
        accountId: 14,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00297392'),
        grossAmount: parseDecimal('0.00301222'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:407:outflow:0',
      }),
      createCandidate({
        id: 2,
        transactionId: 409,
        accountId: 16,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00083993'),
        grossAmount: parseDecimal('0.00087823'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:409:outflow:0',
      }),
      createCandidate({
        id: 3,
        transactionId: 411,
        accountId: 18,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00199199'),
        grossAmount: parseDecimal('0.00203029'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:411:outflow:0',
      }),
      createCandidate({
        id: 4,
        transactionId: 413,
        accountId: 20,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00621314'),
        grossAmount: parseDecimal('0.00625144'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:413:outflow:0',
      }),
      createCandidate({
        id: 5,
        transactionId: 415,
        accountId: 22,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00303659'),
        grossAmount: parseDecimal('0.00307489'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:415:outflow:0',
      }),
    ];

    const targets = [
      createCandidate({
        id: 100,
        transactionId: 264,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('0.01520877'),
        direction: 'in',
        timestamp: targetTimestamp,
        movementFingerprint: 'movement:kraken:264:inflow:0',
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, DEFAULT_MATCHING_CONFIG);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(5);
    expect([...result.value.consumedCandidateIds].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 100]);
    expect(result.value.links.every((link) => link.status === 'confirmed')).toBe(true);
    expect(result.value.links.every((link) => link.metadata?.['sameHashExternalGroup'] === true)).toBe(true);
    expect(result.value.links.every((link) => link.linkType === 'blockchain_to_exchange')).toBe(true);

    const totalSourceAmount = result.value.links.reduce((sum, link) => sum.plus(link.sourceAmount), parseDecimal('0'));
    expect(totalSourceAmount.toFixed()).toBe('0.01520877');

    const linkedSmallestLeg = result.value.links.find((link) => link.sourceTransactionId === 409);
    expect(linkedSmallestLeg?.sourceAmount.toFixed()).toBe('0.00087823');
    expect(linkedSmallestLeg?.metadata?.['feeBearingSourceTransactionId']).toBe(413);
    expect(linkedSmallestLeg?.metadata?.['dedupedSameHashFee']).toBe('0.0000383');
    expect(linkedSmallestLeg?.metadata?.['sameHashExternalSourceAllocations']).toEqual([
      {
        sourceTransactionId: 407,
        grossAmount: '0.00301222',
        linkedAmount: '0.00301222',
        feeDeducted: '0',
      },
      {
        sourceTransactionId: 409,
        grossAmount: '0.00087823',
        linkedAmount: '0.00087823',
        feeDeducted: '0',
      },
      {
        sourceTransactionId: 411,
        grossAmount: '0.00203029',
        linkedAmount: '0.00203029',
        feeDeducted: '0',
      },
      {
        sourceTransactionId: 413,
        grossAmount: '0.00625144',
        linkedAmount: '0.00621314',
        feeDeducted: '0.0000383',
      },
      {
        sourceTransactionId: 415,
        grossAmount: '0.00307489',
        linkedAmount: '0.00307489',
        feeDeducted: '0',
      },
    ]);
  });

  it('skips same-hash groups when tracked blockchain inflows share the hash', () => {
    const hash = '0xshared';
    const timestamp = new Date('2024-01-01T12:00:00Z');

    const sources = [
      createCandidate({
        id: 1,
        transactionId: 10,
        accountId: 1,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1'),
        grossAmount: parseDecimal('1.1'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
      createCandidate({
        id: 2,
        transactionId: 11,
        accountId: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('2'),
        grossAmount: parseDecimal('2.1'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
    ];

    const targets = [
      createCandidate({
        id: 3,
        transactionId: 12,
        accountId: 3,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('3'),
        direction: 'in',
        timestamp,
        blockchainTxHash: hash,
      }),
      createCandidate({
        id: 100,
        transactionId: 20,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('3.1'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, DEFAULT_MATCHING_CONFIG);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(0);
    expect(result.value.consumedCandidateIds.size).toBe(0);
  });

  it('skips the group when more than one exact exchange inflow target matches the synthetic amount', () => {
    const hash = '0xmulti-target';
    const timestamp = new Date('2024-01-01T12:00:00Z');

    const sources = [
      createCandidate({
        id: 1,
        transactionId: 10,
        accountId: 1,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.5'),
        grossAmount: parseDecimal('0.6'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
      createCandidate({
        id: 2,
        transactionId: 11,
        accountId: 2,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.7'),
        grossAmount: parseDecimal('0.8'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
    ];

    const targets = [
      createCandidate({
        id: 100,
        transactionId: 20,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('1.3'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:05:00Z'),
      }),
      createCandidate({
        id: 101,
        transactionId: 21,
        sourceName: 'coinbase',
        sourceType: 'exchange',
        assetId: 'exchange:coinbase:btc',
        amount: parseDecimal('1.3'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, DEFAULT_MATCHING_CONFIG);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(0);
    expect(result.value.consumedCandidateIds.size).toBe(0);
  });
});
