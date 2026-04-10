import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../matching/matching-config.js';
import { createLinkableMovement } from '../../shared/test-utils.js';
import { SameHashExternalOutflowStrategy } from '../same-hash-external-outflow-strategy.js';

describe('SameHashExternalOutflowStrategy', () => {
  it('confirms a same-hash multi-input blockchain send into one exchange deposit using a single deduped fee', () => {
    const hash = 'f976ebbad12a363c826f83a9c02af63bcf1a5475dc688ee87e07d7061611b23c';
    const timestamp = new Date('2024-07-05T11:37:19.000Z');
    const targetTimestamp = new Date('2024-07-05T11:54:06.902Z');
    const toAddress = '3J11opeYh2dBkKXzsCPe6PybEMP729sX1M';

    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 407,
        accountId: 14,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00297392'),
        grossAmount: parseDecimal('0.00301222'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:407:outflow:0',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 409,
        accountId: 16,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00083993'),
        grossAmount: parseDecimal('0.00087823'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:409:outflow:0',
      }),
      createLinkableMovement({
        id: 3,
        transactionId: 411,
        accountId: 18,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00199199'),
        grossAmount: parseDecimal('0.00203029'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:411:outflow:0',
      }),
      createLinkableMovement({
        id: 4,
        transactionId: 413,
        accountId: 20,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.00621314'),
        grossAmount: parseDecimal('0.00625144'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:413:outflow:0',
      }),
      createLinkableMovement({
        id: 5,
        transactionId: 415,
        accountId: 22,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
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
      createLinkableMovement({
        id: 100,
        transactionId: 264,
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('0.01520877'),
        direction: 'in',
        timestamp: targetTimestamp,
        movementFingerprint: 'movement:kraken:264:inflow:0',
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, buildMatchingConfig());

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

  it('suggests a mixed same-hash external group when the exact residual matches one exchange deposit', () => {
    const hash = '0xshared';
    const timestamp = new Date('2024-01-01T12:00:00Z');
    const toAddress = 'addr-1';

    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 10,
        accountId: 1,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.4'),
        grossAmount: parseDecimal('1.5'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:10:outflow:0',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 11,
        accountId: 2,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.8'),
        grossAmount: parseDecimal('1.9'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:11:outflow:0',
      }),
    ];

    const targets = [
      createLinkableMovement({
        id: 3,
        transactionId: 12,
        accountId: 3,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.2'),
        direction: 'in',
        timestamp,
        blockchainTxHash: hash,
        movementFingerprint: 'movement:bitcoin:12:inflow:0',
      }),
      createLinkableMovement({
        id: 100,
        transactionId: 20,
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('2.1'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:kraken:20:inflow:0',
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(3);
    expect([...result.value.consumedCandidateIds].sort((left, right) => left - right)).toEqual([1, 2, 3, 100]);
    expect(result.value.links.every((link) => link.status === 'suggested')).toBe(true);
    expect(result.value.links.every((link) => link.confidenceScore.eq(parseDecimal('1')))).toBe(true);

    const firstLink = result.value.links.find(
      (link) => link.sourceTransactionId === 10 && link.linkType === 'blockchain_to_exchange'
    );
    expect(firstLink?.sourceAmount.toFixed()).toBe('1.5');
    expect(firstLink?.metadata?.['sameHashMixedExternalGroup']).toBe(true);
    expect(firstLink?.metadata?.['sameHashTrackedSiblingInflowAmount']).toBe('1.2');
    expect(firstLink?.metadata?.['sameHashTrackedSiblingInflowCount']).toBe(1);
    expect(firstLink?.metadata?.['sameHashResidualAllocationPolicy']).toBe('transaction_id_prefix');
    expect(firstLink?.metadata?.['sameHashExternalSourceAllocations']).toEqual([
      {
        sourceTransactionId: 10,
        grossAmount: '1.5',
        linkedAmount: '1.5',
        feeDeducted: '0',
      },
      {
        sourceTransactionId: 11,
        grossAmount: '1.9',
        linkedAmount: '0.6',
        feeDeducted: '0.1',
        unlinkedAmount: '1.2',
      },
    ]);

    const secondLink = result.value.links.find(
      (link) => link.sourceTransactionId === 11 && link.linkType === 'blockchain_to_exchange'
    );
    expect(secondLink?.sourceAmount.toFixed()).toBe('0.6');

    const internalLink = result.value.links.find((link) => link.linkType === 'blockchain_internal');
    expect(internalLink).toMatchObject({
      sourceTransactionId: 11,
      targetTransactionId: 12,
      linkType: 'blockchain_internal',
    });
    expect(internalLink?.sourceAmount.toFixed()).toBe('1.2');
    expect(internalLink?.targetAmount.toFixed()).toBe('1.2');
    expect(internalLink?.metadata?.['partialMatch']).toBe(true);
    expect(internalLink?.metadata?.['fullSourceAmount']).toBe('1.8');
    expect(internalLink?.metadata?.['consumedAmount']).toBe('1.2');
    expect(internalLink?.metadata?.['sameHashResidualAllocationPolicy']).toBe('exact_residual_single_source');
    expect(internalLink?.metadata?.['blockchainTxHash']).toBe(hash);
  });

  it('skips the residual internal link when change is spread across multiple source capacities', () => {
    const hash = '0xambiguous-residual';
    const timestamp = new Date('2024-01-01T12:00:00Z');
    const toAddress = 'addr-1';

    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 10,
        accountId: 1,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.4'),
        grossAmount: parseDecimal('1.5'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:10:outflow:0',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 11,
        accountId: 2,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.8'),
        grossAmount: parseDecimal('1.9'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:bitcoin:11:outflow:0',
      }),
    ];

    const targets = [
      createLinkableMovement({
        id: 3,
        transactionId: 12,
        accountId: 3,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('2.3'),
        direction: 'in',
        timestamp,
        blockchainTxHash: hash,
        movementFingerprint: 'movement:bitcoin:12:inflow:0',
      }),
      createLinkableMovement({
        id: 100,
        transactionId: 20,
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('1'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
        blockchainTxHash: hash,
        toAddress,
        movementFingerprint: 'movement:kraken:20:inflow:0',
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(1);
    expect(result.value.links[0]?.linkType).toBe('blockchain_to_exchange');
    expect(result.value.links.find((link) => link.linkType === 'blockchain_internal')).toBeUndefined();
  });

  it('skips mixed groups when the residual does not land at the shared external address', () => {
    const hash = '0xmismatch-address';
    const timestamp = new Date('2024-01-01T12:00:00Z');

    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 10,
        accountId: 1,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.4'),
        grossAmount: parseDecimal('1.5'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 11,
        accountId: 2,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.8'),
        grossAmount: parseDecimal('1.9'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
    ];

    const targets = [
      createLinkableMovement({
        id: 3,
        transactionId: 12,
        accountId: 3,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('1.2'),
        direction: 'in',
        timestamp,
        blockchainTxHash: hash,
      }),
      createLinkableMovement({
        id: 100,
        transactionId: 20,
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('2.1'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
        blockchainTxHash: hash,
        toAddress: 'other-addr',
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, buildMatchingConfig());

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
      createLinkableMovement({
        id: 1,
        transactionId: 10,
        accountId: 1,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        amount: parseDecimal('0.5'),
        grossAmount: parseDecimal('0.6'),
        direction: 'out',
        timestamp,
        blockchainTxHash: hash,
        toAddress: 'addr-1',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 11,
        accountId: 2,
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
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
      createLinkableMovement({
        id: 100,
        transactionId: 20,
        platformKey: 'kraken',
        platformKind: 'exchange',
        assetId: 'exchange:kraken:btc',
        amount: parseDecimal('1.3'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:05:00Z'),
      }),
      createLinkableMovement({
        id: 101,
        transactionId: 21,
        platformKey: 'coinbase',
        platformKind: 'exchange',
        assetId: 'exchange:coinbase:btc',
        amount: parseDecimal('1.3'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00Z'),
      }),
    ];

    const strategy = new SameHashExternalOutflowStrategy();
    const result = strategy.execute(sources, targets, buildMatchingConfig());

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.links).toHaveLength(0);
    expect(result.value.consumedCandidateIds.size).toBe(0);
  });
});
